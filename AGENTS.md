# Weiqi testing preferences

- For routine changes, check a few representative game positions that cover the affected behavior. Do not validate every move in a full game.
- Reserve full-game replay checks for final pre-production validation.
- Keep verification proportionate to the change; avoid broad or repeated checks once the relevant behavior is verified.
- Report changes: change the generation logic, not just existing reports. Bump the report version and date in `src/report-version.js` (the version test prints the new fingerprint). Use the three newest games as templates while designing; test the logic on the next two only after implementing. Re-render only the five newest reports.
