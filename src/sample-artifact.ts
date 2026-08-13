import type { CapabilityArtifact, ControlRef } from "./contracts.js";

function control(
  description: string,
  robustnessNote: string,
  candidates: ControlRef["candidates"],
): ControlRef {
  return { description, robustnessNote, candidates, expectedCardinality: 1 };
}

export const CONTROLS = {
  memberId: control(
    "member ID field",
    "Associated label is stable operator-facing language.",
    [
      { kind: "label", text: "Member ID", exact: true },
      { kind: "role", role: "textbox", name: "Member ID", exact: true },
    ],
  ),
  search: control(
    "search members action",
    "Button role and exact accessible name express intent.",
    [
      { kind: "role", role: "button", name: "Search members", exact: true },
      { kind: "text", text: "Search members", exact: true },
    ],
  ),
  memberDetails: control(
    "member details heading",
    "Page heading is the stable state landmark.",
    [{ kind: "role", role: "heading", name: "Member details", exact: true }],
  ),
  openAccount: control(
    "open new sub-account action",
    "Link role and exact product-language name remain stable across layout changes.",
    [
      { kind: "role", role: "link", name: "Open new sub-account", exact: true },
      { kind: "text", text: "Open new sub-account", exact: true },
    ],
  ),
  accountHeading: control(
    "prepare new sub-account heading",
    "Page heading is the stable resume and checkpoint landmark.",
    [
      {
        kind: "role",
        role: "heading",
        name: "Prepare new sub-account",
        exact: true,
      },
    ],
  ),
  product: control(
    "product selector",
    "Associated label identifies the business field.",
    [
      { kind: "label", text: "Product", exact: true },
      { kind: "role", role: "combobox", name: "Product", exact: true },
    ],
  ),
  nickname: control(
    "account nickname field",
    "Associated label identifies the business field.",
    [
      { kind: "label", text: "Account nickname", exact: true },
      { kind: "role", role: "textbox", name: "Account nickname", exact: true },
    ],
  ),
  review: control(
    "review new sub-account action",
    "Button role and exact name express intent.",
    [
      {
        kind: "role",
        role: "button",
        name: "Review new sub-account",
        exact: true,
      },
    ],
  ),
  reviewHeading: control(
    "review new sub-account heading",
    "Heading verifies the review state.",
    [
      {
        kind: "role",
        role: "heading",
        name: "Review new sub-account",
        exact: true,
      },
    ],
  ),
  confirm: control(
    "confirm account creation action",
    "Exact accessible name identifies the irreversible control for policy blocking.",
    [
      {
        kind: "role",
        role: "button",
        name: "Confirm account creation",
        exact: true,
      },
    ],
  ),
  supervisorVerified: control(
    "supervisor verification action",
    "Exact visible button language identifies the one manual interstitial action.",
    [
      {
        kind: "role",
        role: "button",
        name: "Supervisor verified",
        exact: true,
      },
    ],
  ),
  memberReference: control(
    "prepared member reference value",
    "Value is adjacent to the stable row heading rather than tied to a DOM index.",
    [
      {
        kind: "relative",
        anchorText: "Member reference",
        relation: "following",
        elementHint: "td",
      },
    ],
  ),
  productCode: control(
    "prepared product code value",
    "Value is adjacent to the stable row heading rather than tied to a DOM index.",
    [
      {
        kind: "relative",
        anchorText: "Product code",
        relation: "following",
        elementHint: "td",
      },
    ],
  ),
  productName: control(
    "prepared product name value",
    "Value is adjacent to the stable row heading rather than tied to a DOM index.",
    [
      {
        kind: "relative",
        anchorText: "Product name",
        relation: "following",
        elementHint: "td",
      },
    ],
  ),
  reviewNickname: control(
    "prepared nickname value",
    "Value is adjacent to the stable row heading rather than tied to a DOM index.",
    [
      {
        kind: "relative",
        anchorText: "Nickname",
        relation: "following",
        elementHint: "td",
      },
    ],
  ),
  notFound: control(
    "member-not-found outcome",
    "Visible business language is the domain outcome.",
    [{ kind: "role", role: "heading", name: "Member not found", exact: true }],
  ),
};

export function createPrepareSubaccountArtifact(
  entryUrl = "http://127.0.0.1:4317/backoffice/members/search",
  provenance: CapabilityArtifact["provenance"] = {
    discoveryRunId: "hand-authored-baseline",
    createdAt: "2026-08-13T00:00:00.000Z",
    modelIdentifier: "none-hand-authored",
  },
): CapabilityArtifact {
  const origin = new URL(entryUrl).origin;
  return {
    schemaVersion: "1.0",
    capability: {
      id: "prepare-subaccount",
      name: "Prepare synthetic member sub-account",
      version: 1,
      description:
        "Search a synthetic member, prepare a parameterized sub-account, return the review summary, and stop before confirmation.",
      riskClass: "review_only",
    },
    compatibility: {
      surfaceKind: "web",
      appFamily: "synthetic-credit-union",
      variant: "base",
      allowedOrigins: [origin],
      entryRoutePattern: "^/backoffice/members/search$",
      requiredLandmarks: [{ kind: "visible", target: CONTROLS.memberId }],
    },
    inputSchema: {
      memberId: {
        type: "string",
        required: true,
        sensitive: true,
        description: "Synthetic member identifier used for this invocation.",
      },
      productCode: {
        type: "string",
        required: true,
        description: "Synthetic product code to prepare.",
        allowedValues: ["SAV_PLUS", "MONEY_MARKET"],
      },
      nickname: {
        type: "string",
        required: true,
        description: "Synthetic account nickname shown at review.",
      },
    },
    outputSchema: {
      status: { type: "string", description: "Review readiness state." },
      memberReference: {
        type: "string",
        sensitive: true,
        description: "Redacted synthetic member reference shown at review.",
      },
      productCode: { type: "string", description: "Prepared product code." },
      productName: {
        type: "string",
        description: "Prepared product display name.",
      },
      nickname: { type: "string", description: "Prepared account nickname." },
    },
    outputBindings: {
      status: { kind: "literal", value: "ready_for_review" },
      memberReference: {
        kind: "scalar",
        source: CONTROLS.memberReference,
        parseAs: "string",
        sensitive: true,
      },
      productCode: {
        kind: "scalar",
        source: CONTROLS.productCode,
        parseAs: "string",
      },
      productName: {
        kind: "scalar",
        source: CONTROLS.productName,
        parseAs: "string",
      },
      nickname: {
        kind: "scalar",
        source: CONTROLS.reviewNickname,
        parseAs: "string",
      },
    },
    steps: [
      {
        id: "navigate-search",
        kind: "navigate",
        description: "Open the permitted member-search entry point.",
        riskClass: "safe",
        url: { kind: "literal", value: entryUrl },
        checkpoint: { kind: "visible", target: CONTROLS.memberId },
      },
      {
        id: "fill-member-id",
        kind: "fill",
        description: "Enter the invocation's synthetic member ID.",
        riskClass: "reversible",
        target: CONTROLS.memberId,
        value: { kind: "input", name: "memberId" },
      },
      {
        id: "search-member",
        kind: "click",
        description: "Search for the synthetic member.",
        riskClass: "safe",
        target: CONTROLS.search,
        retryPolicy: {
          maxAttempts: 2,
          conditionCodes: ["TRANSIENT_LOAD_TIMEOUT"],
          strategy: "reload",
          delayMs: 100,
        },
        checkpoint: { kind: "visible", target: CONTROLS.memberDetails },
      },
      {
        id: "open-subaccount",
        kind: "click",
        description: "Open the new sub-account preparation form.",
        riskClass: "review_only",
        target: CONTROLS.openAccount,
        checkpoint: { kind: "visible", target: CONTROLS.accountHeading },
      },
      {
        id: "select-product",
        kind: "select",
        description: "Choose the invocation's product code.",
        riskClass: "reversible",
        target: CONTROLS.product,
        value: { kind: "input", name: "productCode" },
      },
      {
        id: "fill-nickname",
        kind: "fill",
        description: "Enter the invocation's synthetic nickname.",
        riskClass: "reversible",
        target: CONTROLS.nickname,
        value: { kind: "input", name: "nickname" },
      },
      {
        id: "open-review",
        kind: "click",
        description: "Submit the reversible form and reach review.",
        riskClass: "review_only",
        target: CONTROLS.review,
        checkpoint: { kind: "visible", target: CONTROLS.reviewHeading },
      },
    ],
    businessOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        description: "The synthetic application returned no matching member.",
        when: { kind: "visible", target: CONTROLS.notFound },
      },
    ],
    success: {
      kind: "all",
      conditions: [
        { kind: "url_matches", pattern: "/accounts/new/review$" },
        { kind: "visible", target: CONTROLS.reviewHeading },
        { kind: "visible", target: CONTROLS.confirm },
        {
          kind: "value_equals",
          target: CONTROLS.productCode,
          value: { kind: "input", name: "productCode" },
        },
        {
          kind: "value_equals",
          target: CONTROLS.reviewNickname,
          value: { kind: "input", name: "nickname" },
        },
      ],
    },
    provenance,
  };
}
