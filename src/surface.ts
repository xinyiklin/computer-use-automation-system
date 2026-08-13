import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
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
import { AutomationError } from "./errors.js";
import type { EvidenceWriter } from "./evidence.js";
import { assertStepAllowed, assertUrlAllowed } from "./policy.js";

export interface SurfaceSession {
  readonly id: string;
  start(): Promise<void>;
  close(): Promise<void>;
  currentUrl(): string;
  observe(label: string): Promise<Observation>;
  execute(
    step: CapabilityStep,
    inputs: Record<string, string | number | boolean>,
    policy: AutomationPolicy,
    owner: () => ControlOwner,
  ): Promise<unknown>;
  evaluateCondition(
    condition: Condition,
    inputs: Record<string, string | number | boolean>,
  ): Promise<boolean>;
  readControl(target: ControlRef): Promise<string>;
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
  ): Promise<void>;
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

export class PlaywrightSurfaceSession implements SurfaceSession {
  public readonly id = randomUUID();
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private observations = 0;
  private blockedNavigation: AutomationError | undefined;

  public constructor(
    private readonly evidence: EvidenceWriter,
    private readonly policy: AutomationPolicy,
    private readonly options: { headed?: boolean } = {},
  ) {}

  public async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: !this.options.headed });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
    });
    await this.context.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        request.frame() === this.page?.mainFrame()
      ) {
        try {
          assertUrlAllowed(request.url(), this.policy);
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
    });
    this.page = await this.context.newPage();
  }

  public async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  public currentUrl(): string {
    return this.requirePage().url();
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
          const hint = candidate.elementHint ?? "input, button, select, a";
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

  public async execute(
    step: CapabilityStep,
    inputs: Record<string, string | number | boolean>,
    policy: AutomationPolicy,
    owner: () => ControlOwner,
  ): Promise<unknown> {
    if (owner() !== "automation") {
      throw new AutomationError(
        "CONTROL_NOT_OWNED_BY_AUTOMATION",
        `Automation action rejected while ${owner()} owns control`,
        "hard_failure",
        { stepId: step.id },
      );
    }
    assertStepAllowed(step, policy);
    const page = this.requirePage();
    this.blockedNavigation = undefined;
    let result: unknown;
    switch (step.kind) {
      case "navigate": {
        const url = String(valueFrom(step.url, inputs));
        assertUrlAllowed(url, policy, step.id);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        break;
      }
      case "click":
        await (await this.candidateLocator(step.target)).click();
        break;
      case "fill":
        await (
          await this.candidateLocator(step.target)
        ).fill(String(valueFrom(step.value, inputs)));
        break;
      case "select":
        await (
          await this.candidateLocator(step.target)
        ).selectOption(String(valueFrom(step.value, inputs)));
        break;
      case "read":
        result = await this.readControl(step.target);
        break;
      case "waitFor":
        await this.waitForCondition(step.condition, inputs);
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
    if (this.blockedNavigation) throw this.blockedNavigation;
    return result;
  }

  private async waitForCondition(
    condition: Condition,
    inputs: Record<string, string | number | boolean>,
  ): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await this.evaluateCondition(condition, inputs)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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

  public async readControl(target: ControlRef): Promise<string> {
    const locator = await this.candidateLocator(target);
    const tagName = await locator.evaluate((element) =>
      element.tagName.toLowerCase(),
    );
    if (["input", "select", "textarea"].includes(tagName)) {
      return await locator.inputValue();
    }
    return (await locator.textContent())?.trim() ?? "";
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
    await (await this.candidateLocator(target)).click();
  }

  public async reload(
    policy: AutomationPolicy,
    owner: () => ControlOwner,
    stepId: string,
  ): Promise<void> {
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
    await this.requirePage().reload({ waitUntil: "domcontentloaded" });
  }

  public async observe(label: string): Promise<Observation> {
    const page = this.requirePage();
    this.observations += 1;
    const fileName = `${String(this.observations).padStart(2, "0")}-${label.replace(/[^a-z0-9-]/gi, "-")}.png`;
    const screenshot = await page.screenshot({
      path: this.evidence.absolutePath(fileName),
      fullPage: true,
      mask: [
        page.locator(
          'input[type="password"], input[name="memberId"], input[autocomplete*="cc-"]',
        ),
      ],
      maskColor: "#111827",
    });
    const snapshot = await page.locator("body").evaluate((body) => {
      const controls = [
        ...body.querySelectorAll("input, select, textarea, button, a"),
      ].map((element) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const label =
          html.getAttribute("aria-label") ??
          (input.labels?.[0]?.textContent ?? "").trim() ??
          html.textContent?.trim() ??
          "";
        return {
          tag: element.tagName.toLowerCase(),
          role: html.getAttribute("role"),
          label,
          value: "value" in input ? input.value : "",
          disabled: "disabled" in input ? input.disabled : false,
        };
      });
      return {
        visibleText: ((body as HTMLElement).innerText ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        semanticTree: controls
          .map(
            (control) =>
              `${control.tag}[role=${control.role ?? "implicit"}] label=${JSON.stringify(control.label)} value=${JSON.stringify(control.value)} disabled=${control.disabled}`,
          )
          .join("\n"),
        controls,
      };
    });
    const observation: Observation = {
      url: page.url(),
      title: await page.title(),
      ...snapshot,
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
    return observation;
  }
}
