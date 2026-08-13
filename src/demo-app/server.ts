import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import express, { type Request, type Response } from "express";

import { MEMBERS, getProduct } from "./fixtures.js";
import {
  accountFormPage,
  createdPage,
  memberPage,
  permissionDeniedPage,
  reviewPage,
  searchPage,
  supervisorPage,
  transientPage,
} from "./pages.js";

interface SessionState {
  supervisorVerified: Set<string>;
  delayedMembersSeen: Set<string>;
}

export interface DemoServer {
  app: express.Express;
  server: Server;
  origin: string;
  close(): Promise<void>;
  reset(): void;
  state: { confirmAttempts: number };
}

function parseCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export async function createDemoServer(port = 0): Promise<DemoServer> {
  const app = express();
  const sessions = new Map<string, SessionState>();
  const state = { confirmAttempts: 0 };

  app.use(express.urlencoded({ extended: false }));
  app.use((request: Request, response: Response, next) => {
    let sessionId = parseCookie(request.headers.cookie, "demoSession");
    if (!sessionId) {
      sessionId = randomUUID();
      response.setHeader(
        "Set-Cookie",
        `demoSession=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/`,
      );
    }
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        supervisorVerified: new Set<string>(),
        delayedMembersSeen: new Set<string>(),
      });
    }
    response.locals.sessionId = sessionId;
    next();
  });

  const sessionFor = (response: Response): SessionState => {
    const sessionId = String(response.locals.sessionId);
    const session = sessions.get(sessionId);
    if (!session) throw new Error("Demo session was not initialized");
    return session;
  };

  app.get("/", (_request, response) =>
    response.redirect("/backoffice/members/search"),
  );
  app.get("/backoffice/members/search", (_request, response) =>
    response.send(searchPage()),
  );
  app.post("/backoffice/members/search", (request, response) => {
    const memberId = String(request.body.memberId ?? "")
      .trim()
      .toUpperCase();
    if (!MEMBERS[memberId]) {
      response.status(200).send(searchPage({ memberId, notFound: true }));
      return;
    }
    response.redirect(`/backoffice/members/${encodeURIComponent(memberId)}`);
  });

  app.get("/backoffice/members/:memberId", (request, response) => {
    const memberId = request.params.memberId.toUpperCase();
    const member = MEMBERS[memberId];
    if (!member) {
      response.status(404).send(searchPage({ memberId, notFound: true }));
      return;
    }
    const session = sessionFor(response);
    if (
      member.delayMode === "once" &&
      !session.delayedMembersSeen.has(memberId)
    ) {
      session.delayedMembersSeen.add(memberId);
      response.status(503).send(transientPage(memberId));
      return;
    }
    response.send(memberPage(member));
  });

  app.get("/backoffice/members/:memberId/accounts/new", (request, response) => {
    const memberId = request.params.memberId.toUpperCase();
    const member = MEMBERS[memberId];
    if (!member) {
      response.status(404).send(searchPage({ memberId, notFound: true }));
      return;
    }
    if (!member.canOpenSubaccount) {
      response.status(403).send(permissionDeniedPage(member));
      return;
    }
    const session = sessionFor(response);
    if (
      member.requiresSupervisorVerification &&
      !session.supervisorVerified.has(memberId)
    ) {
      response.send(supervisorPage(member));
      return;
    }
    response.send(accountFormPage(member));
  });

  app.post("/backoffice/supervisor/verify", (request, response) => {
    const memberId = String(request.body.memberId ?? "")
      .trim()
      .toUpperCase();
    const member = MEMBERS[memberId];
    if (!member) {
      response.status(404).send(searchPage({ memberId, notFound: true }));
      return;
    }
    sessionFor(response).supervisorVerified.add(memberId);
    response.redirect(
      `/backoffice/members/${encodeURIComponent(memberId)}/accounts/new`,
    );
  });

  app.post(
    "/backoffice/members/:memberId/accounts/new/review",
    (request, response) => {
      const memberId = request.params.memberId.toUpperCase();
      const member = MEMBERS[memberId];
      if (!member) {
        response.status(404).send(searchPage({ memberId, notFound: true }));
        return;
      }
      const productCode = String(request.body.productCode ?? "");
      const nickname = String(request.body.nickname ?? "").trim();
      const product = getProduct(productCode);
      if (!product || nickname.length < 1 || nickname.length > 40) {
        response.status(422).send(
          accountFormPage(member, {
            productCode,
            nickname,
            error:
              "Choose an available product and provide a nickname of 1–40 characters.",
          }),
        );
        return;
      }
      response.send(reviewPage(member, product, nickname));
    },
  );

  app.post(
    "/backoffice/members/:memberId/accounts/new/confirm",
    (request, response) => {
      const memberId = request.params.memberId.toUpperCase();
      const member = MEMBERS[memberId];
      if (!member) {
        response.status(404).send(searchPage({ memberId, notFound: true }));
        return;
      }
      state.confirmAttempts += 1;
      response.send(createdPage(member));
    },
  );

  app.get("/__test/state", (_request, response) => response.json(state));
  app.post("/__test/reset", (_request, response) => {
    sessions.clear();
    state.confirmAttempts = 0;
    response.status(204).end();
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(port, "127.0.0.1", () => resolve(listening));
    listening.on("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Demo server address unavailable");
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    app,
    server,
    origin,
    state,
    reset() {
      sessions.clear();
      state.confirmAttempts = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
