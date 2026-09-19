// The ladders a fighter climbs, one rank per prestige.
//
// Everyone starts in the Space Force and climbs its ten officer ranks. At
// General there is nothing above, so they may retire: the Medal of Honor
// goes next to their name, their MMR and prestige count go back to zero,
// and they enlist in the next branch — nine enlisted ranks, then ten officer
// ranks — and so on round the services. Both sides read this file: the
// browser to draw a rank, the Worker to decide whether a prestige or a
// retirement is allowed.

const OFFICERS_ARMY = [
  ["Second Lieutenant", "2LT"], ["First Lieutenant", "1LT"], ["Captain", "CPT"], ["Major", "MAJ"],
  ["Lieutenant Colonel", "LTC"], ["Colonel", "COL"], ["Brigadier General", "BG"], ["Major General", "MG"],
  ["Lieutenant General", "LTG"], ["General", "GEN"],
];
const OFFICERS_NAVY = [
  ["Ensign", "ENS"], ["Lieutenant Junior Grade", "LTJG"], ["Lieutenant", "LT"], ["Lieutenant Commander", "LCDR"],
  ["Commander", "CDR"], ["Captain", "CAPT"], ["Rear Admiral (lower half)", "RDML"], ["Rear Admiral", "RADM"],
  ["Vice Admiral", "VADM"], ["Admiral", "ADM"],
];
const OFFICERS_SPACE = [
  ["Second Lieutenant", "2LT"], ["First Lieutenant", "1LT"], ["Captain", "CPT"], ["Major", "MAJ"],
  ["Lieutenant Colonel", "LTC"], ["Colonel", "COL"], ["Brigadier General", "BG"], ["Major General", "MG"],
  ["Lieutenant General", "LTG"], ["General", "GEN"],
];

const rows = (kind, list) => list.map(([name, abbr], i) => ({ name, abbr, kind, grade: i + 1 }));

export const BRANCHES = [
  { id: "space", name: "Space Force", emoji: "🚀", enlisted: [], officers: rows("officer", OFFICERS_SPACE) },
  { id: "army", name: "Army", emoji: "🪖", enlisted: rows("enlisted", [
    ["Private", "PVT"], ["Private Second Class", "PV2"], ["Private First Class", "PFC"], ["Specialist", "SPC"],
    ["Sergeant", "SGT"], ["Staff Sergeant", "SSG"], ["Sergeant First Class", "SFC"], ["Master Sergeant", "MSG"],
    ["Sergeant Major", "SGM"],
  ]), officers: rows("officer", OFFICERS_ARMY) },
  { id: "navy", name: "Navy", emoji: "⚓", enlisted: rows("enlisted", [
    ["Seaman Recruit", "SR"], ["Seaman Apprentice", "SA"], ["Seaman", "SN"], ["Petty Officer Third Class", "PO3"],
    ["Petty Officer Second Class", "PO2"], ["Petty Officer First Class", "PO1"], ["Chief Petty Officer", "CPO"],
    ["Senior Chief Petty Officer", "SCPO"], ["Master Chief Petty Officer", "MCPO"],
  ]), officers: rows("officer", OFFICERS_NAVY) },
  { id: "marines", name: "Marine Corps", emoji: "🦅", enlisted: rows("enlisted", [
    ["Private", "PVT"], ["Private First Class", "PFC"], ["Lance Corporal", "LCPL"], ["Corporal", "CPL"],
    ["Sergeant", "SGT"], ["Staff Sergeant", "SSGT"], ["Gunnery Sergeant", "GYSGT"], ["Master Sergeant", "MSGT"],
    ["Sergeant Major", "SGTMAJ"],
  ]), officers: rows("officer", OFFICERS_ARMY) },
  { id: "airforce", name: "Air Force", emoji: "✈️", enlisted: rows("enlisted", [
    ["Airman Basic", "AB"], ["Airman", "AMN"], ["Airman First Class", "A1C"], ["Senior Airman", "SRA"],
    ["Staff Sergeant", "SSGT"], ["Technical Sergeant", "TSGT"], ["Master Sergeant", "MSGT"],
    ["Senior Master Sergeant", "SMSGT"], ["Chief Master Sergeant", "CMSGT"],
  ]), officers: rows("officer", OFFICERS_ARMY) },
  { id: "coastguard", name: "Coast Guard", emoji: "🛟", enlisted: rows("enlisted", [
    ["Seaman Recruit", "SR"], ["Seaman Apprentice", "SA"], ["Seaman", "SN"], ["Petty Officer Third Class", "PO3"],
    ["Petty Officer Second Class", "PO2"], ["Petty Officer First Class", "PO1"], ["Chief Petty Officer", "CPO"],
    ["Senior Chief Petty Officer", "SCPO"], ["Master Chief Petty Officer", "MCPO"],
  ]), officers: rows("officer", OFFICERS_NAVY) },
];

/** The branch for a stored index; anything unknown is the Space Force. */
export const branchOf = (i) => BRANCHES[((Math.round(Number(i) || 0) % BRANCHES.length) + BRANCHES.length) % BRANCHES.length];
export const nextBranch = (i) => (Math.round(Number(i) || 0) + 1) % BRANCHES.length;
export const ladderOf = (i) => { const b = branchOf(i); return [...b.enlisted, ...b.officers]; };

/**
 * The rank held after `prestige` promotions in a branch: null before the
 * first. Past the top the rank stays the top — there is nothing above it,
 * only retirement.
 */
export function rankOf(branch, prestige) {
  const ladder = ladderOf(branch);
  const n = Math.round(Number(prestige) || 0);
  if (n < 1) return null;
  const r = ladder[Math.min(n, ladder.length) - 1];
  return { ...r, branch: branchOf(branch), step: Math.min(n, ladder.length), top: ladder.length };
}

export const atTop = (branch, prestige) => (Math.round(Number(prestige) || 0)) >= ladderOf(branch).length;

/** "Sergeant, Army" — or "General, Space Force". */
export function rankLabel(branch, prestige) {
  const r = rankOf(branch, prestige);
  return r ? `${r.name}, ${r.branch.name}` : "";
}
