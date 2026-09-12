# Third-Party Notices

DevConvert bundles the following third-party libraries. Each is vendored under `/vendor` as a version-pinned ESM bundle and imported only through `src/vendor.js`. No dependency is fetched from a CDN at runtime.

The vendored files are minified redistributions (bundled by jsDelivr) and **do not carry an embedded license header**. The copyright lines reproduced below were taken from each project's upstream `LICENSE` file at the version indicated, and the upstream repository URL is given in every section so the text can be verified. Confirm each notice against its upstream source before publishing a production deployment.

Contents:

1. [js-yaml 4.1.0 — MIT](#1-js-yaml-410)
2. [smol-toml 1.3.1 — BSD-3-Clause](#2-smol-toml-131)
3. [Papa Parse 5.4.1 — MIT](#3-papa-parse-541)
4. [diff 5.2.0 — BSD-3-Clause](#4-diff-520)
5. [ulid 2.3.0 — MIT](#5-ulid-230)
6. [js-md5 0.8.3 — MIT](#6-js-md5-083)
7. [Modifications to vendored files](#modifications-to-vendored-files)

DevConvert also uses the Web Crypto API (`crypto.subtle.digest`, `crypto.getRandomValues`, `crypto.randomUUID`) for SHA-1/SHA-256/SHA-384/SHA-512 digests, UUID v4 generation and random number generation. Web Crypto is a browser platform API, not a bundled dependency, and carries no license obligation.

---

## 1. js-yaml 4.1.0

- **Vendored as:** `vendor/js-yaml.mjs`
- **License:** MIT
- **Project URL:** https://github.com/nodeca/js-yaml
- **Used for:** YAML parsing (`load`) and serialization (`dump`).

```
(The MIT License)

Copyright (C) 2011-2015 by Vitaly Puzrin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 2. smol-toml 1.3.1

- **Vendored as:** `vendor/smol-toml.mjs`
- **License:** BSD-3-Clause
- **Project URL:** https://github.com/squirrelchat/smol-toml
- **Used for:** TOML parsing and stringification.

```
BSD 3-Clause License

Copyright (c) Cynthia Rey et al., All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 3. Papa Parse 5.4.1

- **Vendored as:** `vendor/papaparse.mjs`
- **License:** MIT
- **Project URL:** https://github.com/mholt/PapaParse
- **Used for:** CSV and TSV parsing, delimiter detection, and CSV generation (`unparse`).

```
The MIT License (MIT)

Copyright (c) 2015 Matthew Holt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 4. diff 5.2.0

Also published as "jsdiff".

- **Vendored as:** `vendor/diff.mjs`
- **License:** BSD-3-Clause
- **Project URL:** https://github.com/kpdecker/jsdiff
- **Used for:** line, word and character diffing, and unified patch generation.

```
Software License Agreement (BSD License)

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>

All rights reserved.

Redistribution and use of this software in source and binary forms, with or
without modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of Kevin Decker nor the names of its contributors may be
  used to endorse or promote products derived from this software without
  specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 5. ulid 2.3.0

- **Vendored as:** `vendor/ulid.mjs` — **modified**, see [Modifications to vendored files](#modifications-to-vendored-files)
- **License:** MIT
- **Project URL:** https://github.com/ulid/javascript
- **Used for:** ULID generation, including the monotonic factory.

```
MIT License

Copyright (c) 2017 Alizain Feerasta

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 6. js-md5 0.8.3

- **Vendored as:** `vendor/js-md5.mjs`
- **License:** MIT
- **Project URL:** https://github.com/emn178/js-md5
- **Used for:** MD5 digests. MD5 is offered as a legacy checksum only and is not used for any security purpose in DevConvert. All cryptographic hashing (SHA-256/384/512, SHA-1) uses the native Web Crypto API instead.

```
MIT License

Copyright (c) 2014-2023 Chen, Yi-Cyuan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Modifications to vendored files

Both the MIT and BSD-3-Clause licenses permit modification, and it is standard practice to disclose changes made to redistributed code. One vendored file has been modified.

### `vendor/ulid.mjs` — modified

The file carries this notice at the top:

```
/* DevConvert local patch: detectPrng() resolves Web Crypto via globalThis/self
   instead of window only, so ULID generation also works inside Web Workers and
   non-window ESM hosts. Restore the stock file from
   https://cdn.jsdelivr.net/npm/ulid@2.3.0/+esm if you need to undo this. */
```

**The change.** Upstream ulid 2.3.0 detects a source of randomness by looking for `window.crypto` (or `window.msCrypto`) and, when no `window` object exists, falling back to a CommonJS `require('crypto')`. Neither path works in this application: an ES module in a browser has no CommonJS `require`, and code running inside a Web Worker has `self` but no `window`. The patch changes the root-object lookup to try `globalThis` first, then `self`, before reading `.crypto` from it, so the Web Crypto API is found in every context DevConvert runs in. No other behaviour, algorithm or output format was altered.

**Restoring the stock file.** The unmodified upstream bundle is not kept in the repository. To diff against it, download `https://cdn.jsdelivr.net/npm/ulid@2.3.0/+esm` — that is the exact artifact this file was vendored from.

**Independently of this patch**, `src/vendor.js` passes an explicit CSPRNG built on `globalThis.crypto.getRandomValues()` into both `factory()` and `monotonicFactory()`, so ULIDs are cryptographically random regardless of what the library's own detection resolves to.

All other files in `/vendor` are unmodified redistributions of the upstream published bundles at the versions listed above.
