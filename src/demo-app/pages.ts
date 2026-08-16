import type { MemberFixture } from "./fixtures.js";
import { PRODUCTS } from "./fixtures.js";

/*
THESIS: A reliable operator ledger, not a dashboard of decorative cards.
OWN-WORLD: Fluorescent-office light, ink navy, ledger gray, teal actions, amber state; square tables and workman controls.
STORY: A staff operator searches a clearly synthetic member, prepares one bounded change, verifies the review ledger, and stops.
FIRST VIEWPORT: Institutional masthead, synthetic-data notice, narrow workflow rail, then the active form/table with its primary action in reading order.
FORM: Operate mode; a restrained late-legacy servicing workstation, selected because automation needs stable visible language more than visual novelty.
*/

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const STYLES = `
  :root {
    color-scheme: light;
    --ink: #10253d;
    --ink-soft: #41556c;
    --paper: #f4f6f7;
    --panel: #ffffff;
    --line: #bdc8d1;
    --line-strong: #7e909f;
    --navy: #12304c;
    --teal: #006c67;
    --teal-hover: #005651;
    --amber: #a05a00;
    --amber-bg: #fff3d6;
    --danger: #8f232b;
    --danger-bg: #fff0f1;
    --success: #1e6641;
    --success-bg: #eaf7ef;
    --shadow: 0 7px 22px rgba(16, 37, 61, 0.12);
    font-family: Tahoma, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); line-height: 1.48; }
  a { color: var(--teal); text-underline-offset: 0.18em; }
  a:hover { color: var(--teal-hover); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
    outline: 3px solid #f0a202; outline-offset: 2px;
  }
  .masthead { background: var(--navy); color: white; border-bottom: 5px solid #1b7b75; }
  .masthead-inner { max-width: 1120px; margin: 0 auto; padding: 18px 28px 16px; display: flex; align-items: end; justify-content: space-between; gap: 24px; }
  .brand { margin: 0; font-size: 1.35rem; letter-spacing: -0.02em; }
  .brand span { display: block; margin-top: 3px; color: #c6d9e6; font-size: 0.78rem; font-weight: 400; letter-spacing: 0.04em; }
  .system-state { font-size: 0.8rem; color: #e9f6f4; }
  .system-state::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 7px; border-radius: 50%; background: #58d0a7; }
  .synthetic { background: var(--amber-bg); color: #6b3b00; border-bottom: 1px solid #e2bd70; }
  .synthetic p { max-width: 1120px; margin: 0 auto; padding: 9px 28px; font-size: 0.82rem; font-weight: 700; }
  .shell { max-width: 1120px; margin: 0 auto; padding: 34px 28px 56px; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 30px; }
  .workflow { border-right: 1px solid var(--line); padding-right: 24px; }
  .workflow h2 { margin: 0 0 16px; font-size: 0.78rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.08em; }
  .workflow ol { list-style: none; padding: 0; margin: 0; counter-reset: step; }
  .workflow li { counter-increment: step; display: grid; grid-template-columns: 26px 1fr; gap: 9px; padding: 8px 0; color: var(--ink-soft); font-size: 0.87rem; }
  .workflow li::before { content: counter(step); display: grid; place-items: center; width: 23px; height: 23px; border: 1px solid var(--line-strong); color: var(--ink-soft); font-size: 0.72rem; font-weight: 700; }
  .workflow li.active { color: var(--ink); font-weight: 700; }
  .workflow li.active::before { background: var(--teal); color: white; border-color: var(--teal); }
  main { min-width: 0; }
  .page-heading { margin: 0 0 7px; font-size: clamp(1.6rem, 4vw, 2.35rem); letter-spacing: -0.025em; line-height: 1.1; }
  .lede { max-width: 68ch; margin: 0 0 28px; color: var(--ink-soft); }
  .panel { background: var(--panel); border: 1px solid var(--line-strong); box-shadow: var(--shadow); }
  .panel-title { margin: 0; padding: 12px 16px; background: #e4eaf0; border-bottom: 1px solid var(--line-strong); font-size: 0.96rem; }
  .panel-body { padding: 22px; }
  .field { display: grid; grid-template-columns: minmax(150px, 0.34fr) minmax(0, 1fr); gap: 18px; align-items: start; padding: 12px 0; border-bottom: 1px solid #dce2e7; }
  .field:last-of-type { border-bottom: 0; }
  label { font-weight: 700; padding-top: 8px; }
  input, select { width: min(100%, 420px); min-height: 42px; border: 1px solid var(--line-strong); border-radius: 2px; background: white; color: var(--ink); padding: 9px 11px; font: inherit; }
  input:hover, select:hover { border-color: var(--teal); }
  .hint { display: block; margin-top: 6px; color: var(--ink-soft); font-size: 0.78rem; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 22px; }
  button, .button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; border: 1px solid var(--teal); border-radius: 3px; background: var(--teal); color: white; padding: 9px 18px; font: 700 0.9rem/1 Tahoma, Arial, sans-serif; text-decoration: none; cursor: pointer; box-shadow: 0 3px 8px rgba(0, 83, 80, 0.18); }
  button:hover, .button:hover { background: var(--teal-hover); color: white; }
  .button.secondary { background: white; color: var(--teal); box-shadow: none; }
  .button.danger, button.danger { background: var(--danger); border-color: var(--danger); }
  table { width: 100%; border-collapse: collapse; background: white; }
  th, td { padding: 12px 14px; border: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { width: 34%; background: #edf1f4; font-size: 0.86rem; }
  .notice { margin: 0 0 24px; padding: 14px 16px; border: 1px solid; }
  .notice h2 { margin: 0 0 5px; font-size: 1rem; }
  .notice p { margin: 0; }
  .notice.error { background: var(--danger-bg); color: #67161c; border-color: #cf8e94; }
  .notice.warning { background: var(--amber-bg); color: #623600; border-color: #d6aa55; }
  .notice.success { background: var(--success-bg); color: #164a30; border-color: #7cb995; }
  .member-bar { display: flex; flex-wrap: wrap; gap: 16px 28px; margin: 0 0 24px; padding: 13px 16px; background: #dce8ee; border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .member-bar strong { display: block; font-size: 0.72rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.06em; }
  .footer { max-width: 1120px; margin: 0 auto; padding: 20px 28px 36px; color: var(--ink-soft); font-size: 0.78rem; }
  @media (max-width: 760px) {
    .masthead-inner { align-items: start; flex-direction: column; }
    .shell { grid-template-columns: 1fr; padding-inline: 18px; }
    .workflow { border-right: 0; border-bottom: 1px solid var(--line); padding: 0 0 18px; }
    .workflow ol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 14px; }
    .field { grid-template-columns: 1fr; gap: 4px; }
    label { padding-top: 0; }
    th { width: 42%; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .notice { animation: settle 320ms cubic-bezier(.16,1,.3,1); }
    @keyframes settle { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0); } }
  }
`;

function layout(title: string, activeStep: number, body: string): string {
  const steps = [
    "Find member",
    "Review member",
    "Prepare account",
    "Review change",
  ];
  return `<!doctype html>
<html lang="en" data-automation-surface-kind="web" data-automation-app-family="synthetic-credit-union" data-automation-variant="base">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Harborline CU Operations</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="masthead">
    <div class="masthead-inner">
      <h1 class="brand">Harborline CU Operations<span>Member servicing workstation</span></h1>
      <div class="system-state">Training environment online</div>
    </div>
  </header>
  <div class="synthetic"><p>SIMULATION ONLY — all members, accounts, and outcomes on this local application are synthetic.</p></div>
  <div class="shell">
    <aside class="workflow" aria-label="Workflow progress">
      <h2>Sub-account preparation</h2>
      <ol>${steps.map((step, index) => `<li class="${index + 1 === activeStep ? "active" : ""}">${step}</li>`).join("")}</ol>
    </aside>
    <main>${body}</main>
  </div>
  <footer class="footer">Harborline demonstration system · No real institution, member, or financial data.</footer>
</body>
</html>`;
}

export function searchPage(
  options: { memberId?: string; notFound?: boolean } = {},
): string {
  const notice = options.notFound
    ? `<section class="notice warning" data-business-code="MEMBER_NOT_FOUND"><h2>Member not found</h2><p>No member matched <strong data-sensitive="memberId">${escapeHtml(options.memberId ?? "")}</strong>. Verify the synthetic member ID and try again.</p></section>`
    : "";
  return layout(
    "Member search",
    1,
    `${notice}
     <h1 class="page-heading">Find a member</h1>
     <p class="lede">Enter a synthetic member identifier to begin a bounded account-preparation workflow.</p>
     <section class="panel" aria-labelledby="search-title">
       <h2 class="panel-title" id="search-title">Member lookup</h2>
       <div class="panel-body">
         <form method="post" action="/backoffice/members/search">
           <div class="field">
             <label for="member-id">Member ID</label>
             <div><input id="member-id" name="memberId" autocomplete="off" value="${escapeHtml(options.memberId ?? "")}" required><span class="hint">Examples: M-1001, M-1002, M-4040, M-4290, M-4030, M-7000</span></div>
           </div>
           <div class="actions"><button type="submit">Search members</button></div>
         </form>
       </div>
     </section>`,
  );
}

export function transientPage(memberId: string): string {
  return layout(
    "Temporary load condition",
    2,
    `<section class="notice warning" data-recoverable-code="TRANSIENT_LOAD_TIMEOUT">
       <h1 class="page-heading">Member record is still loading</h1>
       <p>The servicing host returned a temporary condition for <span data-sensitive="memberId">${escapeHtml(memberId)}</span>. A bounded reload may recover it.</p>
     </section>`,
  );
}

export function memberPage(member: MemberFixture): string {
  return layout(
    "Member details",
    2,
    `<h1 class="page-heading">Member details</h1>
     <p class="lede">Confirm the synthetic record before preparing a new sub-account.</p>
     <div class="member-bar"><span><strong>Reference</strong><span data-sensitive="memberReference">${escapeHtml(member.displayReference)}</span></span><span><strong>Name</strong>${escapeHtml(member.name)}</span><span><strong>Status</strong>Active</span></div>
     <section class="panel" aria-labelledby="accounts-title">
       <h2 class="panel-title" id="accounts-title">Current accounts</h2>
       <div class="panel-body">
         <table><tbody><tr><th scope="row">Primary savings</th><td>Open · synthetic balance hidden</td></tr><tr><th scope="row">Membership share</th><td>Open</td></tr></tbody></table>
         <div class="actions"><a class="button" href="/backoffice/members/${encodeURIComponent(member.id)}/accounts/new">Open new sub-account</a></div>
       </div>
     </section>`,
  );
}

export function permissionDeniedPage(member: MemberFixture): string {
  return layout(
    "Permission denied",
    3,
    `<section class="notice error" data-failure-code="PERMISSION_DENIED">
       <h1 class="page-heading">Permission denied</h1>
       <p>This operator cannot prepare a new sub-account for <span data-sensitive="memberReference">${escapeHtml(member.displayReference)}</span>. Stop and route the failure for review.</p>
     </section>
     <a href="/backoffice/members/${encodeURIComponent(member.id)}">Return to member details</a>`,
  );
}

export function supervisorPage(member: MemberFixture): string {
  return layout(
    "Supervisor verification required",
    3,
    `<section class="notice warning" data-intervention-code="SUPERVISOR_VERIFICATION_REQUIRED">
       <h1 class="page-heading">Supervisor verification required</h1>
       <p>A person must verify this synthetic member before account preparation can continue. Automation must pause and preserve this session.</p>
     </section>
     <form method="post" action="/backoffice/supervisor/verify">
       <input type="hidden" name="memberId" value="${escapeHtml(member.id)}">
       <button type="submit">Supervisor verified</button>
     </form>`,
  );
}

export function accountFormPage(
  member: MemberFixture,
  options: { productCode?: string; nickname?: string; error?: string } = {},
): string {
  const error = options.error
    ? `<section class="notice error" data-failure-code="INPUT_REJECTED"><h2>Check the account details</h2><p>${escapeHtml(options.error)}</p></section>`
    : "";
  return layout(
    "Prepare new sub-account",
    3,
    `${error}
     <h1 class="page-heading">Prepare new sub-account</h1>
     <p class="lede">Enter the requested values. This flow prepares a review only and does not create an account.</p>
     <div class="member-bar"><span><strong>Reference</strong><span data-sensitive="memberReference">${escapeHtml(member.displayReference)}</span></span><span><strong>Name</strong>${escapeHtml(member.name)}</span></div>
     <section class="panel" aria-labelledby="account-title">
       <h2 class="panel-title" id="account-title">Account details</h2>
       <div class="panel-body">
         <form method="post" action="/backoffice/members/${encodeURIComponent(member.id)}/accounts/new/review">
           <div class="field"><label for="product-code">Product</label><select id="product-code" name="productCode" required><option value="">Select a product</option>${PRODUCTS.map((product) => `<option value="${product.code}" ${options.productCode === product.code ? "selected" : ""}>${escapeHtml(product.name)} (${product.code})</option>`).join("")}</select></div>
           <div class="field"><label for="nickname">Account nickname</label><div><input id="nickname" name="nickname" maxlength="40" value="${escapeHtml(options.nickname ?? "")}" required><span class="hint">Synthetic label shown on the review screen.</span></div></div>
           <div class="actions"><button type="submit">Review new sub-account</button><a class="button secondary" href="/backoffice/members/${encodeURIComponent(member.id)}">Cancel</a></div>
         </form>
       </div>
     </section>`,
  );
}

export function reviewPage(
  member: MemberFixture,
  product: { code: string; name: string },
  nickname: string,
): string {
  return layout(
    "Review new sub-account",
    4,
    `<h1 class="page-heading">Review new sub-account</h1>
     <p class="lede">Verify the prepared values. Automated capability success ends on this page before confirmation.</p>
     <section class="notice success"><h2>Ready for review</h2><p>No account has been created.</p></section>
     <section class="panel" aria-labelledby="review-title">
       <h2 class="panel-title" id="review-title">Prepared account summary</h2>
       <div class="panel-body">
         <table aria-label="Prepared account summary"><tbody>
           <tr><th scope="row">Member reference</th><td data-sensitive="memberReference">${escapeHtml(member.displayReference)}</td></tr>
           <tr><th scope="row">Product code</th><td>${escapeHtml(product.code)}</td></tr>
           <tr><th scope="row">Product name</th><td>${escapeHtml(product.name)}</td></tr>
           <tr><th scope="row">Nickname</th><td>${escapeHtml(nickname)}</td></tr>
         </tbody></table>
         <form method="post" action="/backoffice/members/${encodeURIComponent(member.id)}/accounts/new/confirm">
           <input type="hidden" name="productCode" value="${escapeHtml(product.code)}">
           <input type="hidden" name="nickname" value="${escapeHtml(nickname)}">
           <div class="actions"><button class="danger" type="submit">Confirm account creation</button><a class="button secondary" href="/backoffice/members/${encodeURIComponent(member.id)}/accounts/new">Edit details</a></div>
         </form>
       </div>
     </section>`,
  );
}

export function createdPage(member: MemberFixture): string {
  return layout(
    "Account created",
    4,
    `<section class="notice error" data-created="true"><h1 class="page-heading">Account created</h1><p>This route exists only to prove policy blocks it. Automated tests should never reach this page.</p></section><a href="/backoffice/members/${encodeURIComponent(member.id)}">Return to member</a>`,
  );
}
