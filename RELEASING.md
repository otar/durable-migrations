# Releasing

This file is for the maintainer. It gives the procedure to publish a new version of `durable-migrations` to npm.

The workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) publishes the package when you push a tag `v*`. It uses npm trusted publishing (OIDC), so it does not need an npm token. npm also adds a provenance statement to each version that the workflow publishes.

You need write access to the repository `otar/durable-migrations` and an npm account with two-factor authentication.

## Publish the first version

npm accepts a trusted publisher only for a package that is on npm. Thus you publish the first version, 0.1.0, from your computer.

1. Make sure that the CI workflow passes on `main`.
2. In `CHANGELOG.md`, replace `Unreleased` with the date of the release, for example `2026-10-20`.
3. Commit the change.
4. Push the commit to `main`.
5. Make a new clone of `main`.
6. In the folder of the new clone, run `npm ci`.
7. Run `npm test`.
8. Run `npm run test:types`.
9. Run `npm run check:package`.

   This command makes sure that the package has only `LICENSE`, `README.md`, `package.json`, `src/index.d.ts`, and `src/index.js`. If a file is missing or extra, the command fails.

10. Run `npm login`.
11. Run `npm publish --access public`.
12. Run `git tag -a v0.1.0 -m v0.1.0`.
13. Run `git push origin v0.1.0`.

The release workflow runs the tests. It finds 0.1.0 on npm, and it does not publish it again. Version 0.1.0 has no provenance statement.

## Add the trusted publisher

After you publish the first version, do this procedure one time.

If no workflow publishes with a new trusted publisher in 2 days, the trusted publisher expires. Thus, less than 2 days before you push the tag of the next version, do this procedure.

1. Sign in to [npmjs.com](https://www.npmjs.com/).
2. Go to **Packages** > **durable-migrations** > **Settings**.
3. In the section **Trusted Publisher**, select **GitHub Actions**.
4. Type these values:
   - **Organization or user**: `otar`
   - **Repository**: `durable-migrations`
   - **Workflow filename**: `release.yml`
   - **Environment name**: no value
5. In **Allowed actions**, select `npm publish`. The workflow uses `npm publish`, not `npm stage publish`.
6. Save the configuration.

npm does not examine the values when you save them. An incorrect value causes an error only when the workflow publishes. The `repository.url` in `package.json` must also refer to `github.com/otar/durable-migrations`.

After the workflow publishes a version with the trusted publisher, you can make sure that nobody publishes with a token:

1. Go to **Settings** > **Publishing access**.
2. Select **Require two-factor authentication and disallow tokens**.

## Publish a new version

1. Make sure that the CI workflow passes on `main`.
2. Select the new version. Before 1.0.0, a minor version can change the API. Do not use a prerelease version, for example `0.2.0-beta.1`. The release workflow cannot publish a prerelease version.
3. In `CHANGELOG.md`, add a section for the new version above the previous version.
4. In this section, write the date of the release and the changes. At the end of `CHANGELOG.md`, add a link reference for the new version, for example:

   ```
   [0.2.0]: https://github.com/otar/durable-migrations/compare/v0.1.0...v0.2.0
   ```

5. Commit `CHANGELOG.md`.
6. Run `npm version <version>`, for example `npm version 0.2.0`.

   This command changes the version in `package.json` and `package-lock.json`. It also makes a commit and the tag `v0.2.0`.

7. Run `git push origin main`.
8. Run `git push origin v0.2.0`.
9. On the **Actions** tab of the repository, make sure that the workflow **Release** passes.
10. On npmjs.com, make sure that the page of the package shows the new version and its provenance.

## If the release workflow fails

- If the step **Make sure that the tag is the version in package.json** fails, the tag and the version are different. Remove the tag with `git push origin --delete v0.2.0` and `git tag -d v0.2.0`. Correct the version. Then push the correct tag.
- If the step **Make sure that the tag is on main** fails, the tagged commit is not on `main`. Remove the tag. Merge the change into `main`. Tag the commit on `main` with the same version. Then push the tag.
- If the tests fail, the workflow does not publish the package. This also applies to the type tests, the check of the package files, and the build of the example. Remove the tag. Correct the error on `main`. Tag the new commit with the same version. Then push the tag.
- If the step **Publish to npm** fails with `ENEEDAUTH` or `E404 Not Found`, open the trusted publisher on npmjs.com. Compare it with the values in [Add the trusted publisher](#add-the-trusted-publisher). You cannot edit a trusted publisher on npmjs.com. If a value is incorrect, delete the trusted publisher. Add it again. Then, in less than 2 days, select **Re-run jobs** on the page of the workflow run.
- If the trusted publisher expired, delete it on npmjs.com. Add it again. Then, in less than 2 days, select **Re-run jobs** on the page of the workflow run.

npm does not accept the same version two times. If npm has the version, the workflow does not publish it again.
