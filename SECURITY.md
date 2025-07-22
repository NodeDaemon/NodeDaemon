# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of NodeDaemon seriously. If you have discovered a security vulnerability in NodeDaemon, we appreciate your help in disclosing it to us in a responsible manner.

### Reporting Process

1. **DO NOT** create a public GitHub issue for the vulnerability.
2. Email your findings to security[at]nodedaemon.com. Encrypt your findings using our PGP key to prevent this critical information from falling into the wrong hands.
3. Provide as much information as possible about the vulnerability:
   - Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
   - Full paths of source file(s) related to the manifestation of the issue
   - The location of the affected source code (tag/branch/commit or direct URL)
   - Any special configuration required to reproduce the issue
   - Step-by-step instructions to reproduce the issue
   - Proof-of-concept or exploit code (if possible)
   - Impact of the issue, including how an attacker might exploit the issue

### What to Expect

- We will acknowledge receipt of your vulnerability report within 48 hours.
- We will provide an estimated timeline for addressing the vulnerability.
- We will notify you when the vulnerability is fixed.
- We will publicly acknowledge your responsible disclosure, if you wish.

### Security Update Process

1. The reported vulnerability is assigned a primary handler who coordinates the fix and release process.
2. The problem is confirmed and a list of all affected versions is determined.
3. Code is audited to find any potential similar problems.
4. Fixes are prepared for all supported releases.
5. New versions are released and the vulnerability is publicly disclosed.

## Security Best Practices

When using NodeDaemon, follow these security best practices:

### Process Isolation

- Run NodeDaemon with minimal privileges
- Use separate user accounts for different applications
- Avoid running NodeDaemon as root/administrator

### File Permissions

- Restrict access to NodeDaemon configuration files
- Set appropriate permissions on log directories
- Use 0600 permissions for Unix socket files

### Environment Variables

- Never store sensitive data in environment variables passed to processes
- Use secure methods for credential management
- Rotate credentials regularly

### Network Security

- Use firewall rules to restrict access to IPC endpoints
- Monitor for unauthorized connection attempts
- Keep NodeDaemon updated to the latest version

## Known Security Features

NodeDaemon implements several security features:

1. **Input Validation**: All IPC messages are validated before processing
2. **Path Traversal Protection**: File paths are sanitized to prevent directory traversal attacks
3. **Process Isolation**: Each managed process runs in its own context
4. **Secure IPC**: Unix sockets use restrictive permissions (0600)
5. **No External Dependencies**: Reduces attack surface by using only Node.js built-in modules

## Contact

- Security Email: security@nodedaemon.com
- Website: https://nodedaemon.com
- GitHub: https://github.com/nodedaemon/nodedaemon