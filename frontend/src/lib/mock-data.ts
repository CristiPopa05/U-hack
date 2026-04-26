export type Team = {
  id: string;
  name: string;
  short: string;
  city: string;
  founded: number;
};

export const TEAMS: Team[] = [
  { id: "craiova", name: "U Craiova", short: "UCV", city: "Craiova", founded: 1948 },
  { id: "cfr", name: "CFR Cluj", short: "CFR", city: "Cluj-Napoca", founded: 1907 },
  { id: "rapid", name: "Rapid București", short: "RAP", city: "București", founded: 1923 },
  { id: "dinamo", name: "Dinamo București", short: "DIN", city: "București", founded: 1948 },
  { id: "arges", name: "FC Argeș", short: "ARG", city: "Pitești", founded: 1953 },
];

export type StandingRow = {
  pos: number; team: string; p: number; w: number; d: number; l: number; g: string; gd: number; pts: number; form: string[];
};

export const STANDINGS: StandingRow[] = [
  { pos: 1, team: "'U' Cluj", p: 6, w: 4, d: 0, l: 2, g: "10:5", gd: 5, pts: 39, form: ["?", "Î", "Î", "V", "V", "V"] },
  { pos: 2, team: "Univ. Craiova", p: 5, w: 3, d: 0, l: 2, g: "4:5", gd: -1, pts: 39, form: ["?", "V", "Î", "V", "V", "Î"] },
  { pos: 3, team: "CFR Cluj", p: 6, w: 3, d: 1, l: 2, g: "5:5", gd: 0, pts: 37, form: ["?", "V", "V", "E", "Î", "V"] },
  { pos: 4, team: "Rapid București", p: 5, w: 1, d: 1, l: 3, g: "4:6", gd: -2, pts: 32, form: ["?", "Î", "E", "Î", "Î", "V"] },
  { pos: 5, team: "Dinamo București", p: 5, w: 1, d: 2, l: 2, g: "6:7", gd: -1, pts: 31, form: ["?", "V", "E", "E", "Î", "Î"] },
  { pos: 6, team: "FC Argeș", p: 5, w: 1, d: 2, l: 2, g: "2:3", gd: -1, pts: 30, form: ["?", "Î", "E", "E", "Î", "V"] },
];
