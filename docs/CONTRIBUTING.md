# Contributing to ReskFlow

Thank you for your interest in contributing to ReskFlow! We welcome contributions from the community and are grateful for any help you can provide.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive criticism
- Show empathy towards other community members

## How to Contribute

### Reporting Issues

1. Check if the issue already exists in the [issue tracker](https://github.com/Sean-Khorasani/ReskFlow/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Detailed description of the problem
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - System information (OS, Node version, etc.)

### Suggesting Features

1. Check the issue tracker for existing feature requests
2. Create a new issue with the `enhancement` label
3. Provide:
   - Clear use case
   - Proposed solution
   - Alternative solutions considered

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Write or update tests
5. Ensure all tests pass (`npm test`)
6. Update documentation if needed
7. Commit your changes using conventional commits:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `style:` for formatting changes
   - `refactor:` for code refactoring
   - `test:` for test changes
   - `chore:` for maintenance tasks
8. Push to your fork
9. Open a Pull Request

### Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/your-username/ReskFlow.git
   cd ReskFlow
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Start development environment:
   ```bash
   docker-compose up -d
   npm run dev
   ```

### Coding Standards

- Use TypeScript for all new code
- Follow existing code style
- Use ESLint and Prettier configurations
- Write meaningful commit messages
- Add tests for new features
- Keep PRs focused and small

### Testing

- Write unit tests for new functions
- Add integration tests for new endpoints
- Ensure all tests pass before submitting PR
- Aim for >80% code coverage

### Documentation

- Update README.md if needed
- Add JSDoc comments for public APIs
- Update API documentation for new endpoints
- Include examples where helpful

## Review Process

1. All submissions require review
2. PRs must pass all CI checks
3. At least one maintainer approval required
4. Address review feedback promptly
5. Squash commits before merging

## Release Process

- We use semantic versioning
- Releases are tagged and include changelogs
- Breaking changes require major version bump

## Getting Help

- Join our discussions on GitHub
- Check existing documentation
- Ask questions in issues with `question` label

## Recognition

Contributors will be recognized in:
- GitHub contributors page
- Release notes
- Project documentation

Thank you for contributing to ReskFlow!