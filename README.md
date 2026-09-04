# devops-heros

My notes and homework for the DevOps Heros sessions.

## Progress

| # | Session | Notes | Task |
|---|---------|-------|------|
| 1 | DevOps Engineer Roadmap | [session1.md](session1-devops-engineer-roadmap/session1.md) | — |
| 2 | Linux | [session2.md](session2-linux/session2.md) | [task](session2-linux/task/) — not started |
| 3 | Shell Scripting | [task.md](session3-shell-scripting/task.md) | [task](session3-shell-scripting/task/) — not started |
| 4 | Networking | [ip.md](session4-networking/ip.md) | [task](session4-networking/task/) — not started |
| 5 | Git & GitHub | [resources.md](session5-git-github/resources.md) | [task](session5-git-github/task/) — not started |
| 6–7 | Docker | [docker.md](session6-7-docker/docker.md) | [Task 1](session6-7-docker/task/) · [Task 2](session6-7-docker/Task-2/) — **done** |
| 8 | Docker Networking & Volumes | [README.md](session8-docker-networking-volume/README.md) | [task](session8-docker-networking-volume/task/) — **done** |
| 9 | Kubernetes | [Readme.md](session9-k8s/Readme.md) | [task](session9-k8s/task/) — not started |
| 10 | Kubernetes Core Objects | [Readme.md](session10-k8s-core-objects/Readme.md) | [task](session10-k8s-core-objects/task/) — not started |

## How this repo is organised

Each `sessionN-*/` folder holds the course notes and demo files for that session.
My homework for a session lives in its `task/` folder:

```
sessionN-topic/
  session-notes.md        course material
  task/
    README.md             my write-up: commands, output, what I learned
    screenshots/          my own screenshots
```

## Homework links

- Homework doc: https://docs.google.com/document/d/1cjXFYf2Thm8cBEN-0C48B-v02cj3jGLd47lcO18prHE/edit?usp=sharing
- Submission — Section A: https://forms.gle/ydjAJcwxjpjBXgxB8
- Submission — Section B: https://forms.gle/pAuXQaokwVzhRzit6

## Credit

The session notes, PDFs and demo apps come from the
[DevOps Heros course repo](https://github.com/Nency-Ravaliya/devops-heros)
by Nensi Ravaliya, used under the MIT License — see [LICENSE](LICENSE).

Everything under the `task/` folders is my own work.

## A note on the screenshots

The verification screenshots in the `task/` folders were captured with a small
[Playwright](https://playwright.dev/) script rather than by hand:

- **Browser shots** load the real `http://localhost:<port>` served by the running
  container inside a frame that shows the actual URL. The script first checks the URL
  returns HTTP 200 and fails loudly if it does not, so a screenshot only exists if the
  container really answered.
- **Terminal shots** render the genuine stdout/stderr captured from running those exact
  commands on this machine — the text is real output, just typeset for legibility
  instead of being a photo of a console.

Automating it meant I could re-run every check after a change and regenerate all the
proof consistently, instead of retaking screenshots one by one.
