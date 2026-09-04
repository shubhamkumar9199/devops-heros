# Session 5 — Git & GitHub — Tasks

- **Name:** Shubham Kumar
- **Enrollment No:** 24BCS10320

> Demonstrated in a throwaway repo at `/tmp/git-sandbox` so nothing here interferes with
> this repository's own history.

---

## Task 1: `git commit -m` vs `git commit -a -m`

### Objective

Show what the `-a` flag actually changes.

### The theory

`git commit -m` commits **only what is already staged** (what you have `git add`-ed).
`git commit -a -m` additionally stages modifications and deletions of files git is **already
tracking**, then commits. The part people get wrong: `-a` does **not** add untracked files.

### Setup

```bash
git init -b main
echo 'line 1' > file.txt
git add file.txt
git commit -m 'initial commit'

echo 'line 2' >> file.txt        # modify a TRACKED file
echo 'brand new' > untracked.txt # create an UNTRACKED file
```

### Execution and output

![git commit -m vs git commit -a -m](screenshots/task1-commit-a.png)

```text
$ git status --short
 M file.txt
?? untracked.txt
```

`M` = tracked and modified. `??` = untracked. Now the plain commit:

```text
$ git commit -m 'attempt without -a'; echo "exit=$?"
On branch main
Changes not staged for commit:
	modified:   file.txt

Untracked files:
	untracked.txt

no changes added to commit (use "git add" and/or "git commit -a")
exit=1
```

**It refused, exit code 1.** Nothing was staged, so there was nothing to commit — git even
suggests `-a` in the error. Now with `-a`:

```text
$ git commit -a -m 'commit with -a'
[main 5871121] commit with -a
 1 file changed, 1 insertion(+)

$ git status --short
?? untracked.txt
```

**One file changed, not two.** `-a` picked up the `file.txt` modification and committed it,
and `untracked.txt` is still sitting there untracked. That is the whole distinction.

| | `git commit -m` | `git commit -a -m` |
|---|---|---|
| Commits staged changes | yes | yes |
| Stages modified **tracked** files | no | **yes** |
| Stages deleted **tracked** files | no | **yes** |
| Stages **untracked** (new) files | no | **no** |
| Fails when nothing staged | yes (exit 1) | only if nothing tracked changed |

So `-a` is a shortcut for `git add -u && git commit`, never for `git add -A && git commit`.
A new file always needs an explicit `git add`.

---

## Task 2: Git cherry-pick

### Objective

Take a single commit from one branch and apply it to another, without merging the branch.

### Setup

```bash
git switch -c feature
echo 'feature A content' > a.txt && git add a.txt && git commit -m 'feat: add A'
echo 'feature B content' > b.txt && git add b.txt && git commit -m 'feat: add B'
git switch main
echo 'main-only change' > main-only.txt && git add main-only.txt
git commit -m 'chore: main-only commit'   # make main diverge
```

### Execution and output

![git cherry-pick](screenshots/task2-cherry-pick.png)

Before — the branches have diverged:

```text
$ git log --oneline --graph --all --decorate
* bcaec11 (HEAD -> main) chore: main-only commit
| * ee7c94a (feature) feat: add B
|/
* 7878f54 feat: add A
* 5871121 commit with -a
* 050dfd5 initial commit
```

Pick only `feat: add B` across:

```text
$ git cherry-pick ee7c94a
[main d08fc6e] feat: add B
 1 file changed, 1 insertion(+)
 create mode 100644 b.txt
```

After:

```text
$ git log --oneline --graph --all --decorate
* d08fc6e (HEAD -> main) feat: add B
* bcaec11 chore: main-only commit
| * ee7c94a (feature) feat: add B
|/
* 7878f54 feat: add A
* 5871121 commit with -a
* 050dfd5 initial commit
```

The same change now exists on both branches under **different hashes**:

```text
  feature: ee7c94a  feat: add B
  main:    d08fc6e  feat: add B
```

…but the patch is byte-for-byte identical (`b.txt | 1 +` in both). `feature` was left
untouched — cherry-pick copies, it does not move.

### A detail I did not expect

The first time I tried this I cherry-picked `feat: add A` onto main **before** making main
diverge. The result:

```text
  feature: 7878f54 feat: add A
  main:    7878f54 feat: add A
```

**The same hash.** At that moment main was sitting exactly on `feat: add A`'s parent, so
replaying the commit produced an identical parent, tree, message, author and timestamp — and
a git commit hash is a hash of exactly those things. Identical inputs, identical hash.

That is why I redid the demo with main diverged. A commit's identity includes its parent, so
"cherry-pick always creates a new commit" is really "cherry-pick creates a commit with a new
parent, which usually changes the hash". When the parent happens to be unchanged, nothing
changes.

### When to use it

- Pulling one bug fix onto a release branch without dragging in everything else on `main`.
- Recovering a commit made on the wrong branch.
- Not a substitute for merging a whole branch — repeated cherry-picking creates duplicate
  commits that can conflict awkwardly later.

---

## What I learned

- `git status --short` is the fastest way to see the staged/unstaged/untracked split: `M`
  vs ` M` vs `??`.
- A refused commit exiting **1** matters in scripts and CI — `git commit -m` in a pipeline
  will fail the step if nothing was staged.
- A commit hash covers its parent, tree, message, author and committer plus timestamps.
  Understanding that explained the identical-hash surprise above rather than leaving it as
  something weird git did.
- `git switch` is the modern, clearer alternative to `git checkout` for changing branches.

## Problems I hit

- My cherry-pick demo initially looked broken because the hash did not change. I assumed I
  had cherry-picked onto the wrong branch. Actually the demo was too simple — no divergence
  — so the "new" commit was genuinely the same commit. Diverging main first made the
  intended behaviour visible.
