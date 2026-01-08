const { execSync } = require('child_process');
const path = require('path');

// Get version type from command line arguments
const versionType = process.argv[2];

// Validate version type
if (!versionType || !['major', 'minor', 'fix'].includes(versionType)) {
  console.error('❌ Error: Invalid version type');
  console.error('Usage: npm run prod [major|minor|fix]');
  console.error('');
  console.error('Examples:');
  console.error('  npm run prod major');
  console.error('  npm run prod minor');
  console.error('  npm run prod fix');
  process.exit(1);
}

// Check if we're on main branch
try {
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  }).trim();

  if (currentBranch !== 'main') {
    console.error(`❌ Error: Releases can only be created from the 'main' branch`);
    console.error(`   Current branch: ${currentBranch}`);
    console.error(`   Please switch to main branch: git checkout main`);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error: Failed to check current branch');
  console.error('   Make sure you are in a Git repository');
  process.exit(1);
}

// Check if GitHub CLI is installed
try {
  execSync('gh --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Error: GitHub CLI (gh) is not installed');
  console.error('   Install it from: https://cli.github.com/');
  console.error('   Or manually trigger the workflow at: https://github.com/$OWNER/$REPO/actions/workflows/release.yml');
  process.exit(1);
}

// Always pull latest changes FIRST (before checking for uncommitted changes)
console.log('⬇️  Pulling latest changes from remote...');
try {
  execSync('git pull origin main --rebase', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  console.log('✅ Pulled latest changes');
  console.log('');
} catch (pullError) {
  // If rebase fails, try without rebase (might be conflicts or no remote changes)
  try {
    execSync('git pull origin main', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    console.log('✅ Pulled latest changes');
    console.log('');
  } catch (pullError2) {
    console.log('⚠️  Could not pull (this is okay if no remote changes)');
    console.log('');
  }
}

// Check for uncommitted changes - fail if any exist
try {
  const status = execSync('git status --porcelain', {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  }).trim();

  if (status) {
    console.error('❌ Error: Uncommitted changes detected');
    console.error('');
    console.error('All changes must be committed before creating a release.');
    console.error('This ensures releases are created from clean, committed code.');
    console.error('');
    console.error('Uncommitted changes:');
    execSync('git status --short', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    console.error('');
    console.error('Please commit your changes first:');
    console.error('  git add .');
    console.error('  git commit -m "your commit message"');
    console.error('  git push origin main');
    console.error('');
    console.error('Then run the release command again.');
    process.exit(1);
  } else {
    console.log('✅ No uncommitted changes');
    console.log('');
  }
} catch (error) {
  console.error('❌ Error: Failed to check git status');
  console.error(`   ${error.message}`);
  console.error('   Make sure you are in a Git repository');
  process.exit(1);
}

// Trigger GitHub Actions workflow
try {
  console.log(`🚀 Triggering release workflow with ${versionType} version bump...`);
  console.log('   This will:');
  console.log('   1. Calculate the next version based on the latest Git tag');
  console.log('   2. Update package.json version');
  console.log('   3. Commit and tag the version bump');
  console.log('   4. Create a GitHub Release');
  console.log('   5. Build and upload Electron artifacts');
  console.log('');
  
  execSync(
    `gh workflow run release.yml -f version_type=${versionType}`,
    {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    }
  );

  // Get repository info for the URL
  let repoUrl = 'your repository';
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
    }).trim();
    // Extract owner/repo from git URL (handles both https and ssh formats)
    const match = remoteUrl.match(/github\.com[:/]([\w\-]+)\/([\w\-.]+)/);
    if (match) {
      repoUrl = `${match[1]}/${match[2].replace(/\.git$/, '')}`;
    }
  } catch (error) {
    // If we can't detect, use placeholder
  }

  console.log('');
  console.log('✅ Release workflow triggered successfully!');
  console.log(`⏳ Monitor progress at: https://github.com/${repoUrl}/actions`);
  console.log('💡 The workflow will run automatically and create the release.');
} catch (error) {
  // Get repository info for error messages
  let repoUrl = 'your repository';
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([\w\-]+)\/([\w\-.]+)/);
    if (match) {
      repoUrl = `${match[1]}/${match[2].replace(/\.git$/, '')}`;
    }
  } catch (err) {
    // If we can't detect, use placeholder
  }

  console.error('❌ Failed to trigger workflow:', error.message);
  console.error('');
  console.error('Alternatives:');
  console.error(`  1. Manually trigger at: https://github.com/${repoUrl}/actions/workflows/release.yml`);
  console.error('  2. Ensure GitHub CLI is authenticated: gh auth login');
  process.exit(1);
}

