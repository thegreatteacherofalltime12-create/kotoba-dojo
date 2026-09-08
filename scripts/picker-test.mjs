// node scripts/picker-test.mjs
// The picker must survive an index from any era.
const oldStyle = [
  { id: "k001", title: "Way of the Open Hand I", difficulty: "gentle", rows: 11, cols: 11 },
  { id: "k002", title: "Tea and Paper I", difficulty: "steady", rows: 11, cols: 11 },
];
const newStyle = [
  { id: "baseball-e01", theme: "baseball", themeName: "Baseball", difficulty: "easy" },
  { id: "football-h03", theme: "football", themeName: "Football (American)", difficulty: "hard" },
];
const categories = (bank) => {
  const out = [];
  for (const p of bank) {
    const id = p.theme || "archive";
    if (!out.some((c) => c.id === id)) out.push({ id, name: p.themeName || (p.theme ? p.theme : "Archive") });
  }
  return out;
};
let bad = 0;
const ok = (l, c) => { console.log(`${c ? "  pass" : "  FAIL"}  ${l}`); if (!c) bad++; };
ok("a themed archive groups by theme", categories(newStyle).map(c => c.id).join() === "baseball,football");
ok("an untitled older archive still yields a category", categories(oldStyle).length === 1);
ok("and it is named plainly", categories(oldStyle)[0].name === "Archive");
ok("a mixed index keeps both", categories([...oldStyle, ...newStyle]).length === 3);
ok("no category is ever undefined", categories([...oldStyle, ...newStyle]).every(c => !!c.id && !!c.name));
console.log(bad ? `${bad} failing` : "\nthe picker survives any archive");
process.exit(bad ? 1 : 0);
