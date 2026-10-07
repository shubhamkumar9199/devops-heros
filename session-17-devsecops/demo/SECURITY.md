# Security Checks

The container runs as UID 10001 with Flask debug mode disabled. The workflow runs Bandit, pip-audit, Gitleaks and Trivy. Bandit excludes B104 for the container listener and B311 for the reference dashboard's simulated timing.

Gitleaks scans full Git history. The root `.gitleaksignore` lists six exact historical findings from existing session 12 classroom Secret examples. Existing assignment files remain unchanged; new findings still fail the check.

Trivy blocks fixable HIGH/CRITICAL findings. [GitHub Actions passed](https://github.com/shubhamkumar9199/devops-heros/actions/runs/37653691247), including registry push and Kubernetes deployment.
