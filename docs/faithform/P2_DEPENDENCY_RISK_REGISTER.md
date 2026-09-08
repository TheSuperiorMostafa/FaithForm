# Prompt 2 Dependency Risk Register

Date: 2026-08-19  
Baseline manager: pnpm `8.15.9` with frozen lockfile in CI

## Baseline outcome

The dependency remediation upgraded the application to Next.js `15.5.21` Maintenance LTS and aligned `eslint-config-next`. It upgraded and/or pinned `sharp`, `postcss`, `nanoid`, and the test runner; removed unused direct `shadcn` and `@anthropic-ai/sdk` dependencies; and reduced the production dependency graph from 617 to 334 packages in the audit metadata.

The initial audit contained 0 critical, 27 high, 28 moderate, and 5 low findings. The current raw production registry audit contains 0 critical, 2 high, 0 moderate, and 0 low findings. Both remaining high entries refer to `image-size@1.2.1`, have no upstream fixed release, and are mitigated by the reviewed repository patch `patches/image-size@1.2.1.patch`.

`pnpm audit:prod` is the release gate. It verifies that the patch and patched lockfile entry exist before allowing exactly the two advisory IDs below; any other high or critical advisory fails the command. `tests/security/dependency-patch.test.ts` also resolves the installed transitive package and verifies the patched guard is present.

## Open temporary risk treatments

| Advisory | Reachability and exploit condition | Local control | Residual risk | Owner | Review/retirement deadline |
| --- | --- | --- | --- | --- | --- |
| [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) / CVE-2025-71330 | Transitive `image-size` ICNS parsing can fail to make progress on a malicious zero/undersized entry. Reachable only where application code or the transitive presentation path parses attacker-controlled ICNS bytes. | Patch rejects an ICNS entry smaller than the entry header before iteration; input validation and request-size limits remain defense in depth. Audit and installed-package tests enforce the guard. | Parser behavior still depends on a locally maintained patch and has not received an upstream release. Unexpected alternate entry paths may remain. | Security owner and Sermon Builder/export owner | 2026-09-19, or immediately when upstream ships a fix |
| [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) / CVE-2025-71329 | Transitive `image-size` JXL/HEIF ISO-BMFF parsing can loop on a zero/undersized box. Reachable only when such untrusted image bytes reach that detector. | Patch rejects boxes smaller than the 8-byte header before advancing; input validation and size limits remain defense in depth. Audit and installed-package tests enforce the guard. | Same locally maintained patch and upstream dependency risk as above. | Security owner and Sermon Builder/export owner | 2026-09-19, or immediately when upstream ships a fix |

These entries are **not** blanket vulnerability exceptions. They are a narrow source-level treatment pending named security-owner approval in the release record. If approval is not granted, the affected image/presentation path must be disabled or the dependency replaced before production promotion.

## Upgrade decisions

| Dependency/control | Decision | Rationale and follow-up |
| --- | --- | --- |
| Next.js / `eslint-config-next` | Pin `15.5.21` | Moves off the vulnerable 14.x baseline to a supported Maintenance LTS line. Track the official [Next.js support policy](https://nextjs.org/support-policy) and [July 2026 security release](https://nextjs.org/blog/july-2026-security-release); schedule Active LTS migration separately after compatibility validation. |
| `sharp` | Override/pin `0.35.3` | Removes vulnerable older transitive resolutions and makes the production graph deterministic. Re-evaluate the override during routine dependency updates. |
| `postcss` | Direct/override `8.5.26` | Forces a remediated deterministic version across the graph. Remove the override only when all parents resolve an equal or newer safe version. |
| `nanoid` | Override `3.3.18` | Eliminates older vulnerable transitive resolutions. Re-evaluate when parent packages update. |
| `image-size@1.2.1` | Patched dependency | No upstream fixed release was available. Replace with an upstream-fixed release or remove/replace the transitive consumer when feasible. |
| `shadcn`, direct `@anthropic-ai/sdk` | Removed | No repository imports required them; removal reduces attack surface and graph size. |

## Release gates

Before every production promotion:

```bash
pnpm install --frozen-lockfile
pnpm audit:prod
pnpm test:security
pnpm build
```

The security owner must inspect any changed advisory, override, patch, or dependency path. Updating the accepted advisory list without an equivalent reviewed code-level control is prohibited. A future fixed upstream release must remove the patch, remove both accepted advisory IDs, refresh the lockfile, and pass the full verification suite.
