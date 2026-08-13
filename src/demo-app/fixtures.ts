export interface MemberFixture {
  id: string;
  displayReference: string;
  name: string;
  canOpenSubaccount: boolean;
  requiresSupervisorVerification: boolean;
  delayMode?: "once";
}

export const PRODUCTS = [
  { code: "SAV_PLUS", name: "Savings Plus" },
  { code: "MONEY_MARKET", name: "Money Market" },
] as const;

export const MEMBERS: Record<string, MemberFixture> = {
  "M-1001": {
    id: "M-1001",
    displayReference: "Member ••1001",
    name: "Avery Synthetic",
    canOpenSubaccount: true,
    requiresSupervisorVerification: false,
  },
  "M-1002": {
    id: "M-1002",
    displayReference: "Member ••1002",
    name: "Jordan Example",
    canOpenSubaccount: true,
    requiresSupervisorVerification: false,
  },
  "M-4290": {
    id: "M-4290",
    displayReference: "Member ••4290",
    name: "Taylor Delay",
    canOpenSubaccount: true,
    requiresSupervisorVerification: false,
    delayMode: "once",
  },
  "M-4030": {
    id: "M-4030",
    displayReference: "Member ••4030",
    name: "Morgan Restricted",
    canOpenSubaccount: false,
    requiresSupervisorVerification: false,
  },
  "M-7000": {
    id: "M-7000",
    displayReference: "Member ••7000",
    name: "Riley Supervisor",
    canOpenSubaccount: true,
    requiresSupervisorVerification: true,
  },
};

export function getProduct(code: string) {
  return PRODUCTS.find((product) => product.code === code);
}
