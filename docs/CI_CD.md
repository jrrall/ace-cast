# CI/CD Pipeline Documentation

This project uses **Trunk-Based Development (TBD)** with automated semantic versioning and releases.

## 🌊 Workflow Overview

### Branch Strategy
- **Main Branch**: `main` (or `master`) - production-ready code
- **Feature Branches**: Short-lived branches for development
- **No long-lived branches**: Features merged quickly to main

### Development Flow
1. **Create feature branch** from main
2. **Make changes** with conventional commits
3. **Push branch** - CI runs tests and linting
4. **Create PR** to main - CI runs again
5. **Merge PR** - Release workflow runs automatically
6. **Semantic Release** creates tags and releases

## 🚀 GitHub Actions Workflows

### CI Workflow (`.github/workflows/ci.yml`)
**Triggers**: All pushes and PRs
**Runs on**: Ubuntu with Node.js 18, 20, 22 matrix

**Steps**:
- Install dependencies (`npm ci`)
- Run ESLint (`npm run lint`)  
- Run tests (`npm test`)
- Generate coverage report
- Upload coverage to Codecov (optional)

### Release Workflow (`.github/workflows/release.yml`)
**Triggers**: Push to main/master branch only
**Runs on**: Ubuntu with Node.js 20

**Steps**:
1. **Test Job**: Same as CI workflow
2. **Release Job** (only if tests pass):
   - Checkout with full git history
   - Install dependencies
   - Run semantic-release

## 📝 Conventional Commits

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning.

### Commit Format
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Commit Types
- `feat:` - New feature (minor version bump)
- `fix:` - Bug fix (patch version bump)
- `docs:` - Documentation changes (patch version bump)
- `style:` - Code style changes (patch version bump)
- `refactor:` - Code refactoring (patch version bump)
- `perf:` - Performance improvements (patch version bump)
- `test:` - Test changes (patch version bump)
- `build:` - Build system changes (patch version bump)
- `ci:` - CI configuration changes (patch version bump)
- `chore:` - Other changes (no version bump)
- `revert:` - Revert previous commit (patch version bump)

### Examples
```bash
# New feature (bumps 1.0.0 → 1.1.0)
git commit -m "feat: add Texas Hold'em game implementation"

# Bug fix (bumps 1.1.0 → 1.1.1)
git commit -m "fix: resolve player disconnection issue"

# Breaking change (bumps 1.1.1 → 2.0.0)
git commit -m "feat!: redesign game state API

BREAKING CHANGE: Game state structure has changed"

# Documentation (bumps 1.1.1 → 1.1.2)
git commit -m "docs: update README with deployment instructions"

# No release
git commit -m "chore: update dev dependencies"
```

## 🏷️ Semantic Versioning

Versions follow [SemVer](https://semver.org/) format: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (`feat!`, `fix!` with `BREAKING CHANGE`)
- **MINOR**: New features (`feat`)
- **PATCH**: Bug fixes, docs, styles, etc. (`fix`, `docs`, `style`, etc.)

### Release Process
1. **Analyze commits** since last release
2. **Determine version bump** based on commit types
3. **Generate changelog** with categorized changes
4. **Update package.json** version
5. **Create git tag** with new version
6. **Push changes** back to repository
7. **Create GitHub release** with release notes

## 🛠️ Local Development

### Pre-commit Checks
While not enforced locally, you should run these before committing:

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Run tests
npm test

# Check test coverage
npm run test:coverage
```

### Testing Semantic Release Locally
```bash
# Dry run to see what would happen
npx semantic-release --dry-run

# Run semantic release locally (not recommended)
npx semantic-release
```

## 🔧 Configuration Files

### `.releaserc.json`
Configures semantic-release behavior:
- **Branches**: main/master only
- **Plugins**: Commit analysis, changelog, npm, GitHub releases
- **Release rules**: Which commit types trigger releases

### `.commitlintrc.json`
Enforces conventional commit format:
- **Rules**: Commit message structure validation
- **Types**: Allowed commit types
- **Limits**: Header length, body line length

## 📊 Quality Gates

### CI Requirements
All of these must pass for PR merges:
- ✅ **ESLint**: No linting errors
- ✅ **Tests**: All unit tests pass
- ✅ **Coverage**: Test coverage reported
- ✅ **Multi-Node**: Works on Node 18, 20, 22

### Release Requirements
- ✅ **CI passed**: All quality gates green
- ✅ **Main branch**: Only releases from main
- ✅ **Conventional commits**: Proper commit format
- ✅ **No conflicts**: Clean merge required

## 🚨 Troubleshooting

### Failed Release
**Problem**: Release workflow fails
**Solutions**:
- Check commit message format
- Ensure all tests pass
- Verify GitHub token permissions
- Check semantic-release logs

### Wrong Version Bump
**Problem**: Unexpected version number
**Solutions**:
- Review commit messages since last release
- Check `.releaserc.json` release rules
- Use conventional commit format correctly

### Missing Dependencies
**Problem**: CI fails to install packages
**Solutions**:
- Check `package-lock.json` is committed
- Verify Node.js version compatibility
- Update dependencies if needed

## 📚 Additional Resources

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [Semantic Release](https://semantic-release.gitbook.io/)
- [Trunk-Based Development](https://trunkbaseddevelopment.com/)
- [GitHub Actions](https://docs.github.com/en/actions)

---

**Ready to contribute?** 🎯

```bash
# Create feature branch
git checkout -b feat/my-awesome-feature

# Make changes with conventional commits
git commit -m "feat: add new card game"

# Push and create PR
git push origin feat/my-awesome-feature
```