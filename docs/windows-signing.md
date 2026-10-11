# Signing CounterScout for Windows

The current portable release is **unsigned**. Signing confirms publisher identity and detects changes to a binary; it is not an antivirus guarantee. A new signed release can still receive SmartScreen reputation warnings, and EV certificates no longer guarantee an immediate bypass. Keep the same signing identity across releases. [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

## Recommended free route: SignPath Foundation

An individual can maintain an open-source project; a company is not required just to publish one. [SignPath Foundation](https://signpath.org/) offers signing for qualifying open-source projects, subject to approval—not instant self-service signing. For CounterScout, this is the free route worth trying first.

1. Make the GitHub repository public, document the app and release a downloadable portable build.
2. Choose an OSI-approved licence and add its `LICENSE` file. **CounterScout currently has no root licence file**, so it is not yet ready for this application. MIT is a simple permissive option if you own the code and want that licensing; licence choice is yours. Also review permissions for shipped game/map assets and dependency licences.
3. Enable MFA for maintainers. Document who authors/reviews changes and who approves signing. Add a privacy policy describing the optional AI data transfer and FACEIT bridge. Only claim SignPath sponsorship after acceptance.
4. Prepare a Windows CI build from a tagged, reviewed commit, using the existing build script. The provider needs verifiable build provenance; a ZIP built only on your laptop is not enough for its normal signing workflow.
5. [Apply to SignPath](https://signpath.org/apply.html), linking the repository, licence, releases, build workflow and project documentation. Approval and eligibility are determined by the Foundation; a young project may need more verifiable history first.
6. After acceptance, configure the project/artifact and signing policy with their instructions. Build → submit your own `CounterScout.exe` for signing → approve → download the signed artifact → package the final ZIP → verify → publish. Do not sign upstream Python/7-Zip binaries as your own project.

See the [programme conditions](https://signpath.org/terms.html) for source provenance, roles, privacy, metadata and approval requirements. No signing account, paid plan or certificate has been created by this task.

## Alternatives

- **Microsoft Azure Artifact Signing:** managed signing, approximately $9.99/month. Individual eligibility currently covers the USA/Canada; eligible organizations also include EU/UK. As an individual elsewhere, do not buy it before checking eligibility.
- **Publicly trusted CA certificate:** check a certificate authority's individual-developer offering, identity requirements and token/cloud-HSM costs. Self-signed certificates do not solve trust for friends on unrelated Windows installations.
- **Microsoft Store / MSIX:** Store handles signing for MSIX and avoids SmartScreen download warnings, but this changes the current portable distribution workflow. It is not necessary to turn CounterScout into a native application window.

These options and eligibility are described in [Microsoft's signing comparison](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options); pricing and availability can change.

## Verify and package a signed release

Install the **Windows SDK Signing Tools** on the build machine. Use the exact SDK version installed on your computer:

```powershell
$signTool = 'C:\Program Files (x86)\Windows Kits\10\bin\<SDK-version>\x64\signtool.exe'
$version = (Get-Content VERSION).Trim()
$bundle = "dist\CounterScout-$version-windows-x64"
& $signTool verify /pa /all /v "$bundle\CounterScout.exe"
if ($LASTEXITCODE -ne 0) { throw 'Signature verification failed' }
Get-AuthenticodeSignature "$bundle\CounterScout.exe" | Format-List Status,SignerCertificate,TimeStamperCertificate
```

SignPath/cloud signing supplies the signed EXE. If using a trusted certificate in your Windows `CurrentUser\My` store, your provider's tooling can instead sign it with:

```powershell
& $signTool sign /sha1 '<certificate-thumbprint>' /s My /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 "$bundle\CounterScout.exe"
if ($LASTEXITCODE -ne 0) { throw 'Signing failed' }
```

`/sha1` selects the certificate by thumbprint; `/fd SHA256` is the signature digest. Use RFC 3161 timestamping so the signature can remain valid after certificate expiry. Token/HSM/cloud providers may require their own signer rather than this store example. [SignTool reference](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool), [timestamping guidance](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures).

Build with `--no-zip` when signing afterward; **sign before making the final ZIP**. Never modify the EXE after signing. After testing the signed folder, create a new ZIP path that does not already exist:

```powershell
Compress-Archive -LiteralPath $bundle -DestinationPath "$bundle-signed.zip"
Get-FileHash "$bundle-signed.zip" -Algorithm SHA256
```

Publish the signed ZIP as a GitHub Release asset, not the automatically generated source ZIP. Publish its SHA-256 too. A checksum helps verify downloads but is not a substitute for Authenticode signing. Test on a clean Windows machine; do not advise users to disable Defender or Smart App Control.
