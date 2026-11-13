# Pre-2020 source parallels to src/store

Dates checked against npm registry publication timestamps. Sources fetched at the listed historical tags, not current main. Project-author attribution is not a claim of sole authorship of every quoted line.

| Project / author | Version | Publication | Source | Local relationship |
|---|---|---|---|---|
| lowdb / Typicode | 1.0.0 | 2017-08-31 | https://github.com/typicode/lowdb/blob/v1.0.0/src/adapters/FileAsync.js#L36-L38 | Storage adapter delegates serialization and atomic writing; src/store/file.ts createDatabase adapter |
| conf / Sindre Sorhus | 5.0.0 | 2019-06-20 | https://github.com/sindresorhus/conf/blob/v5.0.0/index.d.ts#L172-L221 | Generic T connects stored, accepted and returned values; analogous to typed storage flow, not an identical transaction abstraction |
| co / TJ Holowaychuk | 4.6.0 | 2015-07-09 | https://github.com/tj/co/blob/4.6.0/index.js#L26-L32 | Small public wrapper delegates to substantive implementation; src/store/index.ts modify |
| Bluebird / Petka Antonov | 3.7.2 | 2019-11-28 | https://github.com/petkaantonov/bluebird/blob/v3.7.2/src/using.js#L184-L199 | Preserve operation result while awaiting owned resource disposal; src/store/file.ts exclusive |
| write-file-atomic / Rebecca Turner | 3.0.0 | 2019-05-24 | https://github.com/npm/write-file-atomic/blob/v3.0.0/index.js#L58-L132 | Serialized file access, atomic rename and finally cleanup; src/store/file.ts exclusive and writer composition |

Publication metadata: https://registry.npmjs.org/lowdb , https://registry.npmjs.org/conf , https://registry.npmjs.org/co , https://registry.npmjs.org/bluebird , https://registry.npmjs.org/write-file-atomic . Read the time[version] field.

These are specific structural parallels. They do not establish that the current store's overall decomposition, abstraction count or dependency composition is justified.
