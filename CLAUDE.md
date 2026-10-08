# Notes for Claude

GitHub Copilot also works on this repo and is told (in `.github/copilot-instructions.md`)
to put every fix or feature on a `copilot/<topic>` branch, push it, and open a
pull request. It does not merge or deploy.

At the start of a session, and whenever the owner mentions Copilot's work:

- Run `git fetch origin` and `gh pr list --state open`, and look for `copilot/` branches.
- Review a branch against `master` (`git diff master...origin/<branch>`) before
  building on it. Run `npm test` on it. Report what is wrong as well as what is right.
- If nothing is on GitHub, check Copilot's local clone at
  `C:\Users\mthom\.copilot\repos\` (including `copilot-worktrees\`) for uncommitted
  work, and ask the owner to have it committed and pushed.
- Do not deploy someone else's branch without the owner's go-ahead.

Standing rules from the owner: push to GitHub after every deploy, deploy with
`npm run deploy` (it stamps the build), and run `npm test` first.
