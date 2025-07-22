# Contributing to NodeDaemon

We love your input! We want to make contributing to NodeDaemon as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## We Develop with GitHub

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

## We Use [GitHub Flow](https://guides.github.com/introduction/flow/index.html)

Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code follows the existing style.
6. Issue that pull request!

## Any contributions you make will be under the MIT Software License

In short, when you submit code changes, your submissions are understood to be under the same [MIT License](LICENSE) that covers the project. Feel free to contact the maintainers if that's a concern.

## Report bugs using GitHub's [issues](https://github.com/nodedaemon/nodedaemon/issues)

We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/nodedaemon/nodedaemon/issues/new); it's that easy!

## Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/nodedaemon/nodedaemon.git
   cd nodedaemon
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

## Coding Style

- We use TypeScript for all source code
- 2 spaces for indentation
- Use meaningful variable names
- Add comments for complex logic
- Keep functions small and focused
- Write tests for new functionality

## Testing

- All new features must include tests
- Tests should achieve 100% success rate
- Run `npm test` before submitting PR
- We maintain zero external dependencies

## Project Structure

```
nodedaemon/
├── src/          # TypeScript source code
│   ├── cli/      # CLI implementation
│   ├── core/     # Core components
│   ├── daemon/   # Daemon process
│   ├── types/    # TypeScript types
│   └── utils/    # Utility functions
├── tests/        # Test files
├── dist/         # Compiled JavaScript
└── build/        # Single-file executables
```

## Pull Request Process

1. Update the README.md with details of changes to the interface, if applicable.
2. Update the CHANGELOG.md with notes on your changes.
3. The PR will be merged once you have the sign-off of at least one maintainer.

## Community

- Website: https://nodedaemon.com
- GitHub: https://github.com/nodedaemon/nodedaemon

## License

By contributing, you agree that your contributions will be licensed under its MIT License.