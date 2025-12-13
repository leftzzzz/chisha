# Contributing to 今天吃啥 (ChiSha)

First off, thank you for considering contributing to ChiSha! It's people like you that make ChiSha such a great tool.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct:

- Be respectful and inclusive
- Welcome newcomers and encourage diversity
- Focus on what is best for the community
- Show empathy towards other community members

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, please include as many details as possible:

**Bug Report Template:**

```markdown
**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Environment:**
 - OS: [e.g. iOS, Windows, macOS]
 - Browser: [e.g. chrome, safari]
 - Version: [e.g. 22]
 - Device: [e.g. iPhone 12, Desktop]

**Additional context**
Add any other context about the problem here.
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

**Enhancement Suggestion Template:**

```markdown
**Is your feature request related to a problem? Please describe.**
A clear and concise description of what the problem is. Ex. I'm always frustrated when [...]

**Describe the solution you'd like**
A clear and concise description of what you want to happen.

**Describe alternatives you've considered**
A clear and concise description of any alternative solutions or features you've considered.

**Additional context**
Add any other context or screenshots about the feature request here.
```

### Pull Requests

1. **Fork the repository** and create your branch from `main`.

```bash
git clone https://github.com/your-username/chisha.git
cd chisha
git checkout -b feature/amazing-feature
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

4. **Make your changes**

- Follow the existing code style
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed

5. **Test your changes**

```bash
# Run type check
npm run type-check

# Run linter
npm run lint

# Run tests
npm test

# Build the project
npm run build
```

6. **Commit your changes**

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat: add amazing feature"
git commit -m "fix: resolve issue with turntable"
git commit -m "docs: update README"
```

**Commit types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements

7. **Push to your fork**

```bash
git push origin feature/amazing-feature
```

8. **Open a Pull Request**

- Go to the original repository
- Click "New Pull Request"
- Select your branch
- Fill out the PR template
- Wait for review

**Pull Request Template:**

```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## How Has This Been Tested?
Describe the tests you ran to verify your changes.

## Checklist:
- [ ] My code follows the code style of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published
```

## Development Guidelines

### Code Style

- **TypeScript**: Use strict mode, no `any` types
- **Naming Conventions**:
  - Components: PascalCase (`MyComponent.tsx`)
  - Hooks: camelCase with `use` prefix (`useMyHook.ts`)
  - Utils: camelCase (`myUtil.ts`)
  - Constants: UPPER_CASE (`MY_CONSTANT`)
- **File Organization**:
  - Components in `components/`
  - Hooks in `hooks/`
  - Utils in `lib/`
  - Types in `types/`
  - API routes in `app/api/`

### Component Guidelines

```typescript
/**
 * Brief description of what the component does
 *
 * @example
 * ```tsx
 * <MyComponent prop1="value" />
 * ```
 */
export default function MyComponent({ prop1 }: MyComponentProps) {
  // Component logic
  return (
    // JSX
  );
}

interface MyComponentProps {
  /** Description of prop1 */
  prop1: string;
  /** Description of prop2 */
  prop2?: number;
}
```

### Hook Guidelines

```typescript
/**
 * Brief description of what the hook does
 *
 * @returns Object with hook functionality
 *
 * @example
 * ```tsx
 * const { data, loading } = useMyHook();
 * ```
 */
export function useMyHook() {
  // Hook logic
  return {
    data,
    loading,
    error,
  };
}
```

### API Route Guidelines

```typescript
/**
 * Brief description of the API endpoint
 *
 * @route POST /api/my-endpoint
 * @param {MyRequestType} request - Request body
 * @returns {MyResponseType} Response data
 */
export async function POST(request: Request) {
  try {
    // Validate input
    const body = await request.json();
    const validated = MySchema.parse(body);

    // Process request
    const result = await processRequest(validated);

    // Return success response
    return successResponse(result);
  } catch (error) {
    // Handle errors
    return errorResponse(error);
  }
}
```

### Testing Guidelines

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent prop1="test" />);
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const user = userEvent.setup();
    render(<MyComponent prop1="test" />);

    await user.click(screen.getByRole('button'));
    expect(screen.getByText('clicked')).toBeInTheDocument();
  });
});
```

### Documentation Guidelines

- Add JSDoc comments to all public functions/components
- Update README.md if adding new features
- Update docs/ folder for significant changes
- Include examples in documentation
- Keep documentation in sync with code

## Project Structure

```
chisha/
├── app/                      # Next.js App Router
│   ├── api/                 # API routes
│   ├── history/             # History page
│   └── page.tsx             # Home page
├── components/              # React components
│   ├── ui/                  # Basic UI components
│   ├── input/               # Input components
│   ├── turntable/           # Turntable components
│   ├── restaurant/          # Restaurant components
│   ├── map/                 # Map components
│   └── layout/              # Layout components
├── context/                 # React Context
├── hooks/                   # Custom hooks
├── lib/                     # Utility libraries
├── types/                   # TypeScript types
├── styles/                  # Global styles
├── __tests__/               # Tests
├── docs/                    # Documentation
└── scripts/                 # Build/utility scripts
```

## Git Workflow

We use **Git Flow** branching model:

- `main`: Production-ready code
- `develop`: Integration branch for features
- `feature/*`: New features
- `fix/*`: Bug fixes
- `hotfix/*`: Urgent production fixes

### Branch Naming

- `feature/add-user-auth`
- `fix/turntable-animation-bug`
- `docs/update-api-documentation`
- `refactor/simplify-search-logic`

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Example:**
```
feat(turntable): add custom spin duration

Allow users to configure turntable spin duration between 2-10 seconds.
Includes validation and UI controls.

Closes #123
```

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create release branch
4. Run tests and build
5. Create pull request to `main`
6. After merge, create Git tag
7. Deploy to production

## Getting Help

- **Documentation**: Check the [docs/](./docs) folder
- **Issues**: Search existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact maintainers (if urgent)

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- GitHub contributors page

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Feel free to ask questions by:
- Opening an issue with the `question` label
- Starting a discussion in GitHub Discussions
- Contacting the maintainers

---

**Thank you for contributing to ChiSha!** 🎉
