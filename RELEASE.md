# Release Workflow

This project uses a fully automated SemVer-based release workflow powered by GitHub Actions. Versions are **never manually edited** in `package.json`.

## Quick Start

```bash
npm run prod major  # 2.0.0 → 3.0.0
npm run prod minor  # 2.0.0 → 2.1.0
npm run prod fix    # 2.0.0 → 2.0.1
```

## Release Flow

### Prerequisites

- Must be on the `main` branch
- **All changes must be committed and pushed** (the script will fail if uncommitted changes exist)
- GitHub CLI (`gh`) installed and authenticated
- Write access to the repository

### Process

1. **Development**: Make your changes, commit them with proper messages, and push to `main`
   ```bash
   git add .
   git commit -m "feat: added new feature"
   git push origin main
   ```

2. **Trigger Release**: When ready, run `npm run prod [major|minor|fix]` from the `main` branch
   - Script validates version type and current branch
   - **Fails if uncommitted changes exist** (ensures releases are from clean, committed code)
   - Triggers GitHub Actions workflow via `gh workflow run`

2. **CI Execution** (GitHub Actions):
   - Reads the latest Git tag to determine current version
   - Calculates next version based on input (major/minor/fix)
   - Updates `package.json.version` automatically
   - Commits the version bump to `main` with `[skip ci]` (this is the only commit the release process makes)
   - Creates and pushes a Git tag (e.g., `v2.1.0`)
   - Builds the Electron application
   - Creates a GitHub Release with the tag
   - Uploads Electron build artifacts to the release

3. **Result**:
   - New version committed to `main`
   - Git tag created
   - GitHub Release published
   - Electron installer available for download

## Branch Strategy

- **`dev`**: Development branch, no releases
- **`main`**: Stable branch, only branch that creates releases

The workflow only runs from `main` branch.

## Version Calculation

The workflow:
1. Fetches all Git tags
2. Finds the latest tag matching `v*` pattern
3. If no tags exist, starts from `v2.0.0`
4. Calculates next version based on bump type:
   - **major**: Increments MAJOR, resets MINOR and PATCH to 0
   - **minor**: Increments MINOR, resets PATCH to 0
   - **fix**: Increments PATCH only

## Important Notes

- **Commits and releases are separate**: The release script does NOT commit your changes. You must commit and push your changes first, then trigger the release.
- **Clean working directory required**: The release script will fail if there are uncommitted changes. This ensures releases are created from clean, committed code.
- **Version bump commit**: The only commit the release process makes is the automatic version bump commit in `package.json`.

## Manual Trigger (Alternative)

If GitHub CLI is not available, manually trigger the workflow:

1. Ensure all changes are committed and pushed to `main`
2. Go to: `https://github.com/OWNER/REPO/actions/workflows/release.yml`
3. Click "Run workflow"
4. Select version type (major/minor/fix)
5. Click "Run workflow"

