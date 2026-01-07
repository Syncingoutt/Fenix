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
- GitHub CLI (`gh`) installed and authenticated
- Write access to the repository

### Process

1. **Trigger**: Run `npm run prod [major|minor|fix]` from the `main` branch
   - Script validates version type and current branch
   - Triggers GitHub Actions workflow via `gh workflow run`

2. **CI Execution** (GitHub Actions):
   - Reads the latest Git tag to determine current version
   - Calculates next version based on input (major/minor/fix)
   - Updates `package.json.version` automatically
   - Commits the version bump to `main` with `[skip ci]`
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

## Manual Trigger (Alternative)

If GitHub CLI is not available, manually trigger the workflow:

1. Go to: `https://github.com/OWNER/REPO/actions/workflows/release.yml`
2. Click "Run workflow"
3. Select version type (major/minor/fix)
4. Click "Run workflow"

