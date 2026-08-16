import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ElementHandle,
  type Locator,
  type Page,
} from "playwright";
import type {
  AutomationPolicy,
  CapabilityStep,
  Condition,
  ControlOwner,
  ControlRef,
  Observation,
  ValueSource,
} from "./contracts.js";
import { remainingDeadlineMs } from "./deadline.js";
import { AutomationError } from "./errors.js";
import { sanitizePersisted, type EvidenceWriter } from "./evidence.js";
import {
  assertResolvedControlAllowed,
  assertStepAllowed,
  assertUrlAllowed,
} from "./policy.js";
import { sensitiveValueRepresentations } from "./sensitive-values.js";

export interface SurfaceSession {
  readonly id: string;
  readonly mode: "headed" | "headless";
  start(signal?: AbortSignal): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
  registerSensitiveFields(fields: Iterable<string>): void;
  registerSensitiveValues(values: Iterable<string | number | boolean>): void;
  registerSensitiveOutputs(
    outputs: Iterable<{ name: string; target?: ControlRef }>,
  ): void;
  currentUrl(): string;
  compatibilityIdentity(): Promise<{
    surfaceKind?: string;
    appFamily?: string;
    variant?: string;
  }>;
  observe(label: string): Promise<Observation>;
  execute(
    step: CapabilityStep,
    inputs: Record<string, string | number | boolean>,
    policy: AutomationPolicy,
    owner: () => ControlOwner,
    deadlineMs: number,
  ): Promise<unknown>;
  evaluateCondition(
    condition: Condition,
    inputs: Record<string, string | number | boolean>,
  ): Promise<boolean>;
  readControl(
    target: ControlRef,
    purpose?: "control" | "output",
  ): Promise<string>;
  runtimeState(): Promise<{
    businessCode?: string;
    recoverableCode?: string;
    failureCode?: string;
    interventionCode?: string;
  }>;
  humanClick(target: ControlRef, owner: () => ControlOwner): Promise<void>;
  reload(
    policy: AutomationPolicy,
    owner: () => ControlOwner,
    stepId: string,
    deadlineMs: number,
  ): Promise<void>;
}

function cssString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function valueFrom(
  source: ValueSource,
  inputs: Record<string, string | number | boolean>,
): string | number | boolean {
  if (source.kind === "literal") return source.value;
  const value = inputs[source.name];
  if (value === undefined) {
    throw new AutomationError(
      "INPUT_BINDING_MISSING",
      `No invocation value is bound for ${source.name}`,
      "invalid_artifact",
    );
  }
  return value;
}

function matchesPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

async function optionalAttribute(
  page: Page,
  selector: string,
  attribute: string,
): Promise<string | undefined> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return undefined;
  return (await locator.getAttribute(attribute)) ?? undefined;
}

function relativeElementHint(hint: string | undefined): string {
  switch (hint?.trim().toLowerCase()) {
    case "cell":
    case "table cell":
    case "table cells":
      return "td";
    case "header cell":
    case "table header":
      return "th";
    default:
      return hint ?? "input, button, select, a";
  }
}

export class PlaywrightSurfaceSession implements SurfaceSession {
  public readonly id = randomUUID();
  public readonly mode: "headed" | "headless";
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private observations = 0;
  private blockedNavigation: AutomationError | undefined;
  private aborted = false;
  private activePolicy: AutomationPolicy;
  private readonly sensitiveFields = new Set<string>();
  private readonly sensitiveValues = new Set<string>();
  private readonly sensitiveOutputs = new Map<string, ControlRef | undefined>();

  public constructor(
    private readonly evidence: EvidenceWriter,
    policy: AutomationPolicy,
    private readonly options: {
      headed?: boolean;
      launchBrowser?: () => Promise<Browser>;
      createContext?: (browser: Browser) => Promise<BrowserContext>;
      createPage?: (context: BrowserContext) => Promise<Page>;
    } = {},
  ) {
    this.activePolicy = policy;
    this.mode = options.headed ? "headed" : "headless";
  }

  public async start(signal?: AbortSignal): Promise<void> {
    this.aborted = false;
    const abortable = async <T>(
      operation: Promise<T>,
      disposeLate?: (value: T) => Promise<void>,
    ): Promise<T> => {
      const disposeWhenSettled = (): void => {
        if (!disposeLate) return;
        void operation.then(disposeLate).catch(() => undefined);
      };
      if (!signal) return await operation;
      if (signal.aborted) {
        disposeWhenSettled();
        throw signal.reason;
      }
      let rejectAbort: ((reason: unknown) => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
      });
      const onAbort = () => rejectAbort?.(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        return await Promise.race([operation, aborted]);
      } catch (error) {
        if (signal.aborted) disposeWhenSettled();
        throw error;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const launch = this.options.launchBrowser
      ? this.options.launchBrowser()
      : chromium.launch({ headless: !this.options.headed });
    try {
      this.browser = await abortable(launch, async (browser) =>
        browser.close(),
      );
      if (this.aborted || signal?.aborted) throw signal?.reason;
      const createContext = this.options.createContext
        ? this.options.createContext(this.browser)
        : this.browser.newContext({
            viewport: { width: 1280, height: 800 },
            serviceWorkers: "block",
          });
      this.context = await abortable(createContext, async (context) =>
        context.close(),
      );
      await abortable(
        this.context.route("**/*", async (route) => {
          const request = route.request();
          if (request.isNavigationRequest()) {
            try {
              assertUrlAllowed(request.url(), this.activePolicy);
            } catch (error) {
              this.blockedNavigation =
                error instanceof AutomationError
                  ? error
                  : new AutomationError(
                      "POLICY_NAVIGATION_BLOCKED",
                      "Navigation was blocked by policy",
                      "policy",
                    );
              await route.abort("blockedbyclient");
              return;
            }
          }
          await route.continue();
        }),
      );
      const createPage = this.options.createPage
        ? this.options.createPage(this.context)
        : this.context.newPage();
      this.page = await abortable(createPage, async (page) => page.close());
      this.context.on("page", (page) => {
        if (page === this.page) return;
        this.blockedNavigation = new AutomationError(
          "POLICY_POPUP_BLOCKED",
          "A popup attempted to create a second uncontrolled surface",
          "policy",
        );
        void page.close().catch(() => undefined);
      });
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  public async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
    await Promise.allSettled([
      ...(context ? [context.close()] : []),
      ...(browser ? [browser.close()] : []),
    ]);
  }

  public async abort(): Promise<void> {
    this.aborted = true;
    await this.close();
  }

  public registerSensitiveFields(fields: Iterable<string>): void {
    for (const field of fields) this.sensitiveFields.add(field);
  }

  public registerSensitiveValues(
    values: Iterable<string | number | boolean>,
  ): void {
    for (const value of values) {
      for (const representation of sensitiveValueRepresentations(value)) {
        this.sensitiveValues.add(representation);
      }
    }
  }

  public registerSensitiveOutputs(
    outputs: Iterable<{ name: string; target?: ControlRef }>,
  ): void {
    for (const output of outputs) {
      this.sensitiveOutputs.set(output.name, output.target);
    }
  }

  public currentUrl(): string {
    return this.requirePage().url();
  }

  public async compatibilityIdentity(): Promise<{
    surfaceKind?: string;
    appFamily?: string;
    variant?: string;
  }> {
    return await this.requirePage()
      .locator("html")
      .evaluate((element) => {
        const surfaceKind = element.getAttribute(
          "data-automation-surface-kind",
        );
        const appFamily = element.getAttribute("data-automation-app-family");
        const variant = element.getAttribute("data-automation-variant");
        return {
          ...(surfaceKind === null ? {} : { surfaceKind }),
          ...(appFamily === null ? {} : { appFamily }),
          ...(variant === null ? {} : { variant }),
        };
      });
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new AutomationError(
        "SURFACE_NOT_STARTED",
        "Surface session has not been started",
      );
    }
    return this.page;
  }

  private async candidateLocator(target: ControlRef): Promise<Locator> {
    if (target.framePath && target.framePath.length > 0) {
      throw new AutomationError(
        "FRAME_PATH_UNSUPPORTED_BY_WEB_BASELINE",
        "This baseline records frame paths but requires a future frame adapter to execute them",
      );
    }
    const page = this.requirePage();
    const diagnostics: Array<{ kind: string; count: number }> = [];
    for (const candidate of target.candidates) {
      let locator: Locator | undefined;
      switch (candidate.kind) {
        case "role":
          locator = page.getByRole(
            candidate.role as Parameters<Page["getByRole"]>[0],
            { name: candidate.name, exact: candidate.exact ?? true },
          );
          break;
        case "label":
          locator = page.getByLabel(candidate.text, {
            exact: candidate.exact ?? true,
          });
          break;
        case "text":
          locator = page.getByText(candidate.text, {
            exact: candidate.exact ?? true,
          });
          break;
        case "css":
          locator = page.locator(candidate.selector);
          break;
        case "relative": {
          const anchor = page.getByText(candidate.anchorText, { exact: true });
          const hint = relativeElementHint(candidate.elementHint);
          locator =
            candidate.relation === "within"
              ? anchor.locator(hint)
              : anchor.locator("xpath=..").locator(hint);
          break;
        }
        case "coordinate":
          continue;
      }
      const count = await locator.count();
      diagnostics.push({ kind: candidate.kind, count });
      if (count === target.expectedCardinality) return locator.first();
      if (count > target.expectedCardinality) {
        throw new AutomationError(
          "CONTROL_AMBIGUOUS",
          `Control resolved to ${count} candidates: ${target.description}`,
          "hard_failure",
          { expected: 1, observed: diagnostics },
        );
      }
    }
    throw new AutomationError(
      "CONTROL_NOT_FOUND",
      `No locator candidate resolved: ${target.description}`,
      "hard_failure",
      { expected: target, observed: diagnostics },
    );
  }

  private assertAutomationOwner(
    owner: () => ControlOwner,
    stepId: string,
  ): void {
    const currentOwner = owner();
    if (currentOwner !== "automation") {
      throw new AutomationError(
        "CONTROL_NOT_OWNED_BY_AUTOMATION",
        `Automation action rejected while ${currentOwner} owns control`,
        "hard_failure",
        { stepId },
      );
    }
  }

  private async assertElementAllowed(
    element: ElementHandle<HTMLElement | SVGElement>,
    policy: AutomationPolicy,
    stepId: string,
  ): Promise<void> {
    const values = await element.evaluate((resolved) => {
      const actionable =
        resolved.closest(
          'button, a, input, select, textarea, [role="button"], [role="link"]',
        ) ?? resolved;
      const input = actionable as HTMLInputElement;
      const form = actionable.closest("form");
      const labelledByText = (actionable.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => actionable.ownerDocument.getElementById(id)?.textContent)
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      const labels =
        "labels" in input && input.labels
          ? [...input.labels].map((label) => label.textContent)
          : [];
      return [
        actionable.textContent,
        actionable.getAttribute("aria-label"),
        labelledByText,
        actionable.getAttribute("title"),
        actionable.getAttribute("alt"),
        actionable.getAttribute("name"),
        "value" in input ? String(input.value) : undefined,
        ...labels,
        actionable.getAttribute("formaction"),
        form?.getAttribute("action"),
      ]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.length > 0);
    });
    assertResolvedControlAllowed(values, policy, stepId);
  }

  public async execute(
    step: CapabilityStep,
    inputs: Record<string, string | number | boolean>,
    policy: AutomationPolicy,
    owner: () => ControlOwner,
    deadlineMs: number,
  ): Promise<unknown> {
    this.activePolicy = policy;
    this.assertAutomationOwner(owner, step.id);
    assertStepAllowed(step, policy);
    const page = this.requirePage();
    this.blockedNavigation = undefined;
    let result: unknown;
    try {
      switch (step.kind) {
        case "navigate": {
          const url = String(valueFrom(step.url, inputs));
          assertUrlAllowed(url, policy, step.id);
          this.assertAutomationOwner(owner, step.id);
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: remainingDeadlineMs(deadlineMs, step.id),
          });
          break;
        }
        case "click": {
          const locator = await this.candidateLocator(step.target);
          const element = await locator.elementHandle();
          if (!element) {
            throw new AutomationError(
              "CONTROL_NOT_FOUND",
              `Resolved control detached before action: ${step.target.description}`,
              "hard_failure",
              { stepId: step.id },
            );
          }
          await this.assertElementAllowed(element, policy, step.id);
          this.assertAutomationOwner(owner, step.id);
          const popup = page
            .context()
            .waitForEvent("page", {
              timeout: Math.min(100, remainingDeadlineMs(deadlineMs, step.id)),
            })
            .catch(() => undefined);
          await element.click({
            timeout: remainingDeadlineMs(deadlineMs, step.id),
          });
          const openedPage = await popup;
          if (openedPage && openedPage !== page) {
            this.blockedNavigation ??= new AutomationError(
              "POLICY_POPUP_BLOCKED",
              "A popup attempted to create a second uncontrolled surface",
              "policy",
              { stepId: step.id },
            );
            await openedPage.close().catch(() => undefined);
          }
          break;
        }
        case "fill": {
          const locator = await this.candidateLocator(step.target);
          const element = await locator.elementHandle();
          if (!element) {
            throw new AutomationError(
              "CONTROL_NOT_FOUND",
              `Resolved control detached before action: ${step.target.description}`,
              "hard_failure",
              { stepId: step.id },
            );
          }
          await this.assertElementAllowed(element, policy, step.id);
          this.assertAutomationOwner(owner, step.id);
          await element.fill(String(valueFrom(step.value, inputs)), {
            timeout: remainingDeadlineMs(deadlineMs, step.id),
          });
          break;
        }
        case "select": {
          const locator = await this.candidateLocator(step.target);
          const element = await locator.elementHandle();
          if (!element) {
            throw new AutomationError(
              "CONTROL_NOT_FOUND",
              `Resolved control detached before action: ${step.target.description}`,
              "hard_failure",
              { stepId: step.id },
            );
          }
          await this.assertElementAllowed(element, policy, step.id);
          this.assertAutomationOwner(owner, step.id);
          await element.selectOption(String(valueFrom(step.value, inputs)), {
            timeout: remainingDeadlineMs(deadlineMs, step.id),
          });
          break;
        }
        case "read":
          result = await this.readControl(step.target);
          break;
        case "waitFor":
          this.assertAutomationOwner(owner, step.id);
          await this.waitForCondition(
            step.condition,
            inputs,
            deadlineMs,
            step.id,
          );
          break;
        case "assert":
          if (!(await this.evaluateCondition(step.condition, inputs))) {
            throw new AutomationError(
              "CHECKPOINT_FAILED",
              `Assertion failed at ${step.id}`,
              "hard_failure",
              { stepId: step.id, expected: step.condition },
            );
          }
          break;
      }
    } catch (error) {
      if (this.blockedNavigation) throw this.blockedNavigation;
      throw error;
    }
    remainingDeadlineMs(deadlineMs, step.id);
    if (this.blockedNavigation) throw this.blockedNavigation;
    return result;
  }

  private async waitForCondition(
    condition: Condition,
    inputs: Record<string, string | number | boolean>,
    runDeadlineMs: number,
    stepId: string,
  ): Promise<void> {
    const deadline = Math.min(Date.now() + 5_000, runDeadlineMs);
    while (Date.now() < deadline) {
      if (await this.evaluateCondition(condition, inputs)) return;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))),
      );
    }
    if (Date.now() >= runDeadlineMs) remainingDeadlineMs(runDeadlineMs, stepId);
    throw new AutomationError(
      "WAIT_CONDITION_TIMEOUT",
      "Declared wait condition did not become true",
      "hard_failure",
      { expected: condition, observed: { url: this.currentUrl() } },
    );
  }

  public async evaluateCondition(
    condition: Condition,
    inputs: Record<string, string | number | boolean>,
  ): Promise<boolean> {
    switch (condition.kind) {
      case "visible":
        try {
          return await (
            await this.candidateLocator(condition.target)
          ).isVisible();
        } catch (error) {
          if (
            error instanceof AutomationError &&
            error.code === "CONTROL_NOT_FOUND"
          )
            return false;
          throw error;
        }
      case "hidden":
        try {
          return !(await (
            await this.candidateLocator(condition.target)
          ).isVisible());
        } catch (error) {
          if (
            error instanceof AutomationError &&
            error.code === "CONTROL_NOT_FOUND"
          )
            return true;
          throw error;
        }
      case "url_matches":
        return matchesPattern(this.currentUrl(), condition.pattern);
      case "text_matches":
        return matchesPattern(
          await this.readControl(condition.target),
          condition.pattern,
        );
      case "value_equals":
        return (
          (await this.readControl(condition.target)) ===
          String(valueFrom(condition.value, inputs))
        );
      case "all":
        for (const nested of condition.conditions) {
          if (!(await this.evaluateCondition(nested, inputs))) return false;
        }
        return true;
      case "any":
        for (const nested of condition.conditions) {
          if (await this.evaluateCondition(nested, inputs)) return true;
        }
        return false;
      case "not":
        return !(await this.evaluateCondition(condition.condition, inputs));
    }
  }

  public async readControl(
    target: ControlRef,
    purpose: "control" | "output" = "control",
  ): Promise<string> {
    const locator = await this.candidateLocator(target);
    const summary = await locator.evaluate((element) => {
      const tagName = element.tagName.toLowerCase();
      const input = element as HTMLInputElement;
      const value = ["input", "select", "textarea"].includes(tagName)
        ? input.value
        : (element.textContent?.trim() ?? "");
      return {
        tagName,
        value,
        descendantCount: element.querySelectorAll("*").length,
        hasStructuredDescendant:
          element.querySelector(
            "main, nav, header, footer, section, article, form, table, dl, ul, ol, input, select, textarea, button, a",
          ) !== null,
      };
    });
    if (purpose === "output") {
      const allowedTags = new Set([
        "input",
        "select",
        "textarea",
        "output",
        "td",
        "th",
        "dd",
        "span",
        "strong",
        "code",
      ]);
      if (
        !allowedTags.has(summary.tagName) ||
        summary.value.length > 512 ||
        summary.descendantCount > 8 ||
        summary.hasStructuredDescendant
      ) {
        throw new AutomationError(
          "OUTPUT_SOURCE_UNSAFE",
          "Scalar output source must resolve to one bounded leaf value",
          "invalid_artifact",
          {
            observed: {
              tagName: summary.tagName,
              valueLength: summary.value.length,
              descendantCount: summary.descendantCount,
            },
          },
        );
      }
    }
    return summary.value;
  }

  public async runtimeState(): Promise<{
    businessCode?: string;
    recoverableCode?: string;
    failureCode?: string;
    interventionCode?: string;
  }> {
    const page = this.requirePage();
    const businessCode = await optionalAttribute(
      page,
      "[data-business-code]",
      "data-business-code",
    );
    const recoverableCode = await optionalAttribute(
      page,
      "[data-recoverable-code]",
      "data-recoverable-code",
    );
    const failureCode = await optionalAttribute(
      page,
      "[data-failure-code]",
      "data-failure-code",
    );
    const interventionCode = await optionalAttribute(
      page,
      "[data-intervention-code]",
      "data-intervention-code",
    );
    return {
      ...(businessCode === undefined ? {} : { businessCode }),
      ...(recoverableCode === undefined ? {} : { recoverableCode }),
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(interventionCode === undefined ? {} : { interventionCode }),
    };
  }

  public async humanClick(
    target: ControlRef,
    owner: () => ControlOwner,
  ): Promise<void> {
    if (owner() !== "human") {
      throw new AutomationError(
        "CONTROL_NOT_OWNED_BY_HUMAN",
        `Human action rejected while ${owner()} owns control`,
      );
    }
    const element = await (await this.candidateLocator(target)).elementHandle();
    if (!element) {
      throw new AutomationError(
        "CONTROL_NOT_FOUND",
        `Resolved control detached before human action: ${target.description}`,
      );
    }
    if (owner() !== "human") {
      throw new AutomationError(
        "CONTROL_NOT_OWNED_BY_HUMAN",
        `Human action rejected while ${owner()} owns control`,
      );
    }
    await element.click();
  }

  public async reload(
    policy: AutomationPolicy,
    owner: () => ControlOwner,
    stepId: string,
    deadlineMs: number,
  ): Promise<void> {
    this.activePolicy = policy;
    if (owner() !== "automation") {
      throw new AutomationError(
        "CONTROL_NOT_OWNED_BY_AUTOMATION",
        `Automated reload rejected while ${owner()} owns control`,
        "hard_failure",
        { stepId },
      );
    }
    const currentUrl = this.currentUrl();
    assertStepAllowed(
      {
        id: `${stepId}-recovery-reload`,
        kind: "navigate",
        description: "Reload the current permitted route for bounded recovery.",
        riskClass: "safe",
        url: { kind: "literal", value: currentUrl },
      },
      policy,
    );
    assertUrlAllowed(currentUrl, policy, stepId);
    this.assertAutomationOwner(owner, stepId);
    await this.requirePage().reload({
      waitUntil: "domcontentloaded",
      timeout: remainingDeadlineMs(deadlineMs, stepId),
    });
  }

  public async observe(label: string): Promise<Observation> {
    const page = this.requirePage();
    this.observations += 1;
    const fileName = `${String(this.observations).padStart(2, "0")}-${label.replace(/[^a-z0-9-]/gi, "-")}.png`;
    const sensitiveOutputLabels = [...this.sensitiveOutputs.keys()].map(
      (name) =>
        name
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase(),
    );
    const redactAllPageContent = [...this.sensitiveOutputs.values()].some(
      (target) => target === undefined,
    );
    await page.locator("body").evaluate(
      (body, options) => {
        const { labels, sensitiveValues, redactAll } = options;
        if (redactAll) {
          body.setAttribute("data-automation-redact-all", "true");
        }
        for (const element of body.querySelectorAll(
          "[data-output-name], label, th, dt",
        )) {
          const configuredName = element.getAttribute("data-output-name");
          const text = configuredName ?? element.textContent ?? "";
          if (!labels.includes(text.replace(/\s+/g, " ").trim().toLowerCase()))
            continue;
          if (element instanceof HTMLLabelElement && element.htmlFor) {
            element.ownerDocument
              .getElementById(element.htmlFor)
              ?.setAttribute("data-automation-redact-output", "true");
            continue;
          }
          if (element.matches("th")) {
            const row = element.closest("tr");
            for (const cell of row?.querySelectorAll("td") ?? [])
              cell.setAttribute("data-automation-redact-output", "true");
            continue;
          }
          if (element.matches("dt")) {
            let sibling = element.nextElementSibling;
            while (sibling?.matches("dd")) {
              sibling.setAttribute("data-automation-redact-output", "true");
              sibling = sibling.nextElementSibling;
            }
            continue;
          }
          element.setAttribute("data-automation-redact-output", "true");
        }
        for (const element of body.querySelectorAll(
          "input, textarea, select",
        )) {
          const value = "value" in element ? String(element.value) : "";
          if (
            sensitiveValues.some(
              (sensitive) => sensitive.length > 0 && value.includes(sensitive),
            )
          ) {
            element.setAttribute("data-automation-redact-value", "true");
          }
        }
        const walker = body.ownerDocument.createTreeWalker(
          body,
          NodeFilter.SHOW_TEXT,
        );
        let node = walker.nextNode();
        while (node) {
          const text = node.nodeValue ?? "";
          if (
            sensitiveValues.some(
              (sensitive) => sensitive.length > 0 && text.includes(sensitive),
            )
          ) {
            node.parentElement?.setAttribute(
              "data-automation-redact-value",
              "true",
            );
          }
          node = walker.nextNode();
        }
      },
      {
        labels: sensitiveOutputLabels,
        sensitiveValues: [...this.sensitiveValues],
        redactAll: redactAllPageContent,
      },
    );
    for (const target of this.sensitiveOutputs.values()) {
      if (!target) continue;
      try {
        await (
          await this.candidateLocator(target)
        ).evaluate((element) =>
          element.setAttribute("data-automation-redact-output", "true"),
        );
      } catch {
        // A sensitive output may not exist until the capability reaches review.
      }
    }
    const sensitiveSelector = [
      'input[type="password"]',
      'input[autocomplete*="cc-"]',
      "[data-sensitive]",
      "[data-automation-redact-output]",
      "[data-automation-redact-value]",
      ...(redactAllPageContent ? ["[data-automation-redact-all]"] : []),
      ...[
        ...new Set([
          ...Object.keys(this.activePolicy.sensitiveInputRules),
          ...this.sensitiveFields,
        ]),
      ].map((name) => `[name=${cssString(name)}]`),
    ].join(", ");
    const sensitiveElements = page.locator(sensitiveSelector);
    const surfaceSensitiveValues = new Set([
      ...this.sensitiveValues,
      ...(
        await sensitiveElements.evaluateAll((elements) =>
          elements.flatMap((element) => {
            const input = element as HTMLInputElement;
            return [
              element.textContent?.replace(/\s+/g, " ").trim() ?? "",
              "value" in input ? String(input.value) : "",
            ].filter((value) => value.length > 0);
          }),
        )
      ).flatMap((value) => [value]),
    ]);
    const screenshot = await page.screenshot({
      path: this.evidence.absolutePath(fileName),
      fullPage: true,
      mask: [sensitiveElements],
      maskColor: "#111827",
    });
    const snapshot = await page.locator("body").evaluate((body) => {
      const controls = [
        ...body.querySelectorAll(
          "input, select, textarea, button, a, h1, h2, h3, h4, h5, h6, output, th, td, dt, dd",
        ),
      ]
        .filter(
          (element) =>
            !(element instanceof HTMLInputElement && element.type === "hidden"),
        )
        .map((element) => {
          const html = element as HTMLElement;
          const input = element as HTMLInputElement;
          const tag = element.tagName.toLowerCase();
          const inputType = tag === "input" ? input.type.toLowerCase() : "";
          const region:
            "main" | "navigation" | "header" | "footer" | "document" =
            element.closest("main")
              ? "main"
              : element.closest("aside, nav")
                ? "navigation"
                : element.closest("header")
                  ? "header"
                  : element.closest("footer")
                    ? "footer"
                    : "document";
          const implicitInputRole =
            inputType === "checkbox"
              ? "checkbox"
              : inputType === "radio"
                ? "radio"
                : inputType === "range"
                  ? "slider"
                  : inputType === "number"
                    ? "spinbutton"
                    : inputType === "search"
                      ? "searchbox"
                      : ["button", "image", "reset", "submit"].includes(
                            inputType,
                          )
                        ? "button"
                        : ["email", "tel", "text", "url"].includes(inputType)
                          ? "textbox"
                          : null;
          const implicitRole =
            tag === "a"
              ? "link"
              : tag === "button"
                ? "button"
                : tag === "select"
                  ? "combobox"
                  : tag === "textarea"
                    ? "textbox"
                    : tag === "output"
                      ? "status"
                      : tag === "th"
                        ? html.getAttribute("scope") === "row"
                          ? "rowheader"
                          : "columnheader"
                        : tag === "td"
                          ? "cell"
                          : tag === "dt"
                            ? "term"
                            : tag === "dd"
                              ? "definition"
                              : tag === "input"
                                ? implicitInputRole
                                : /^h[1-6]$/.test(tag)
                                  ? "heading"
                                  : null;
          const labelledBy = (html.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => html.ownerDocument.getElementById(id)?.textContent)
            .filter((value): value is string => typeof value === "string")
            .join(" ")
            .trim();
          const label =
            html.getAttribute("aria-label") ||
            labelledBy ||
            (input.labels?.[0]?.textContent ?? "").trim() ||
            html.textContent?.trim() ||
            "";
          return {
            region,
            tag,
            role: html.getAttribute("role") ?? implicitRole,
            label,
            value: "value" in input ? input.value : "",
            disabled: "disabled" in input ? input.disabled : false,
          };
        });
      const primaryContent = body.querySelector("main") ?? body;
      return {
        visibleText: ((primaryContent as HTMLElement).innerText ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        semanticTree: controls
          .map(
            (control) =>
              `region=${control.region} ${control.tag}[role=${control.role ?? "unknown"}] name=${JSON.stringify(control.label)} value=${JSON.stringify(control.value)} disabled=${control.disabled}`,
          )
          .join("\n"),
        controls,
      };
    });
    const safeSnapshot = redactAllPageContent
      ? {
          visibleText: "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]",
          semanticTree: snapshot.controls
            .map(
              (control) =>
                `region=${control.region} ${control.tag}[role=${control.role ?? "unknown"}] name="[WITHHELD]" value="[WITHHELD]" disabled=${control.disabled}`,
            )
            .join("\n"),
          controls: snapshot.controls.map((control) => ({
            ...control,
            label: "[WITHHELD]",
            value: "[WITHHELD]",
          })),
        }
      : (sanitizePersisted(
          snapshot,
          new Set(),
          surfaceSensitiveValues,
        ) as typeof snapshot);
    const observation: Observation = {
      url: redactAllPageContent
        ? "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]"
        : (sanitizePersisted(
            page.url(),
            new Set(),
            surfaceSensitiveValues,
          ) as string),
      title: redactAllPageContent
        ? "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]"
        : (sanitizePersisted(
            await page.title(),
            new Set(),
            surfaceSensitiveValues,
          ) as string),
      ...safeSnapshot,
      screenshotDataUrl: `data:image/png;base64,${screenshot.toString("base64")}`,
      screenshotPath: this.evidence.relativePath(fileName),
      stepCount: this.observations,
    };
    await this.evidence.json(
      `${String(this.observations).padStart(2, "0")}-${label}-surface.json`,
      {
        ...observation,
        screenshotDataUrl: "[OMITTED_FROM_PERSISTED_SNAPSHOT]",
      },
    );
    await page
      .locator(
        "[data-automation-redact-output], [data-automation-redact-value], [data-automation-redact-all]",
      )
      .evaluateAll((elements) =>
        elements.forEach((element) => {
          element.removeAttribute("data-automation-redact-output");
          element.removeAttribute("data-automation-redact-value");
          element.removeAttribute("data-automation-redact-all");
        }),
      );
    return observation;
  }
}
