/**
 * seo-content.mjs — the per-tool copy that appears on each static landing page.
 *
 * Build-time only. Nothing here is imported by src/app.js, so none of this text
 * is downloaded by someone using the app; it exists for the page a search
 * engine and a first-time visitor land on.
 *
 * `handles` states what the tool does with real input. `useCases` are the
 * situations someone actually arrives in, and `faq` the questions they arrive
 * with; both are editorial, so they live here rather than in the registry,
 * where a wrong sentence could not change how a converter behaves.
 *
 * `sample.input` is run through the tool's own `run()` at build time and the
 * result is printed as the example, so the page cannot drift from the behaviour
 * it describes. Tools whose output is random or time-dependent carry no sample:
 * uuid-generator and ulid-generator are random, and the timestamp converter
 * prints a relative phrase and a local time that would be frozen to whichever
 * machine ran the build.
 */

export const PAGE_CONTENT = {
  'format-converter': {
    handles: [
      'Any pair of JSON, YAML, TOML, CSV, TSV, XML and HTML tables — 49 combinations from one pair of selectors.',
      'CSV and TSV delimiters are detected automatically: comma, semicolon, tab or pipe.',
      'A table with no header row is detected and its columns are named column1 to columnN.',
      'Values read from CSV, TSV, XML and HTML stay strings until "Infer numbers and booleans" is switched on.',
      'A nested value written into a table cell is serialized as JSON text inside that cell.',
    ],
    useCases: [
      { title: 'A pair that has no page of its own', body: 'Six pairings — JSON with YAML, TOML and CSV in both directions — have a dedicated page each. The other forty-three, YAML to XML or TSV to TOML among them, are reachable only from these two selectors.' },
      { title: 'A table copied out of a rendered page', body: 'The HTML reader looks for a <table> of <tr> rows with <th> or <td> cells, so a table lifted from documentation or an admin screen can be read straight into JSON or TSV.' },
      { title: 'Reversing the direction you just ran', body: 'The swap button exchanges the two selectors and re-runs against the text already in the input box, rather than making you retype it on another page.' },
      { title: 'Validating a file without changing its format', body: 'Selecting the same format on both sides parses the document and writes it out again, which reports the syntax error or normalises the indentation of a YAML or TOML file in place.' },
    ],
    faq: [
      { q: 'Does pasting a different format switch the input selector?', a: 'No. Content that looks like another format raises an offer above the input reading "Read input as …", which you accept or ignore. Nothing is switched and nothing is rewritten for you.' },
      { q: 'Why does XML gain or lose an outer element?', a: 'Reading XML keeps the document element as a wrapping key, so an <order> document becomes {"order": …} and then an [order] table in TOML. Writing XML reverses that: a single top-level key supplies the element name rather than becoming a child of it.' },
      { q: 'Which options are in play for my pair?', a: 'Each control declares the formats it affects and hides itself otherwise — the CSV delimiter appears only when CSV or TSV is on one side, the XML root element only when XML is the output, and key sorting only when YAML is.' },
      { q: 'What extension does the download get?', a: 'The one belonging to the output selector, not the page you started on: picking XML downloads .xml with an application/xml media type.' },
    ],
    sample: { input: '[{"id":1,"name":"Ada","tags":["math","code"]}]' },
  },

  'json-to-yaml': {
    handles: [
      'Indentation of 2 or 4 spaces. Output is always block style, never flow style.',
      'Keys can be sorted alphabetically instead of keeping their original order.',
      'Repeated structures are written out in full; no anchors or aliases are emitted.',
      'Strings that YAML would otherwise read as numbers, booleans or dates are quoted.',
    ],
    useCases: [
      { title: 'A Kubernetes manifest back into the repo', body: 'kubectl get deployment -o json gives you the live object; this turns it back into the YAML shape a manifest file is expected to have.' },
      { title: 'Writing a Docker Compose file', body: 'A compose definition assembled in a script is easier to build as JSON. Convert it once at the end so the checked-in compose.yaml stays hand-editable.' },
      { title: 'Config for a Spring or Rails app', body: 'Take a settings object you already have as JSON and emit the application.yml form, with nesting rather than dotted keys.' },
      { title: 'Seeding a Helm values file', body: 'Turn the default values an operator emits as JSON into the values.yaml a chart consumer will read and comment.' },
    ],
    faq: [
      { q: 'Why did a long string get wrapped across lines?', a: 'Output folds at 120 columns, so a long value becomes a >- folded block. A single token with no spaces in it cannot be folded and is left on one line.' },
      { q: 'How is a string containing newlines written?', a: 'As a | literal block, so a shell script or a certificate stays readable line by line instead of collapsing into one quoted string full of \\n escapes.' },
      { q: 'Does "Sort keys alphabetically" apply to nested objects?', a: 'Yes, it sorts at every level, not just the top one. Leave it off to keep the original JSON key order.' },
      { q: 'Does the compact indentation choice produce flow style?', a: 'No. YAML output here is always block style, and the compact choice falls back to two spaces, so it gives the same result as the 2-space choice. Pick 4 spaces if your linter wants them.' },
    ],
    sample: { input: '{"name":"Ada","active":true,"ports":[80,443]}' },
  },

  'yaml-to-json': {
    handles: [
      'Dates in the YAML document become ISO 8601 strings.',
      'NaN and Infinity become null.',
      'Tabs used for indentation are rejected, and the error carries the line and column.',
      'Multi-document YAML is not supported; one document per conversion.',
    ],
    useCases: [
      { title: 'Querying a GitHub Actions workflow', body: 'Turn .github/workflows/ci.yml into JSON so you can pull out job names or matrix entries with jq instead of grepping indented text.' },
      { title: 'Helm values against an API payload', body: 'Convert a values.yaml fragment to JSON and diff it against what the cluster API actually returned, without the indentation getting in the way.' },
      { title: 'An OpenAPI spec for a generator', body: 'Most YAML-authored OpenAPI documents have to be handed to client generators and schema validators as JSON. This does that one step.' },
      { title: 'Ansible vars into a test fixture', body: 'Paste a group_vars block and get a JSON object you can drop straight into a unit test or a mock response.' },
    ],
    faq: [
      { q: 'Are anchors, aliases and merge keys resolved?', a: 'Yes. An &anchor referenced by *alias is written out in full wherever it was used, and a << merge key is flattened into the mapping that inherits it. The JSON has no reference back to the original anchor.' },
      { q: 'Does "on:" in a workflow file become true?', a: 'No. Parsing follows the YAML 1.2 core rules, so on, off, yes and no all stay strings; only true and false become JSON booleans.' },
      { q: 'What happens to duplicate keys?', a: 'The document is rejected rather than silently collapsed. The error reads "duplicated mapping key" and carries the line and column of the second occurrence.' },
      { q: 'Do large integers survive the conversion?', a: 'Not beyond 2^53. YAML integers are read as JavaScript numbers, so 12345678901234567890 comes out as 12345678901234567000. Quote the value in the YAML if the exact digits matter.' },
    ],
    sample: { input: 'name: Ada\nactive: true\nports:\n  - 80\n  - 443\n' },
  },

  'json-to-toml': {
    handles: [
      'A JSON array at the document root is wrapped in a table named items, and the wrapping is reported.',
      'Null values are dropped and every dropped path is reported.',
      'Nested objects become TOML tables and arrays of objects become [[array]] blocks.',
    ],
    useCases: [
      { title: 'Writing a Cargo or pyproject section', body: 'A dependency map you already hold as JSON becomes a [dependencies] table, and a nested object such as tool.ruff becomes the [tool.ruff] header that file expects.' },
      { title: 'Repeated blocks in a wrangler.toml', body: 'An array of objects is emitted as one [[name]] block per element, which is the shape [[kv_namespaces]] or [[redirects]] entries take when a script generates them rather than a person typing them.' },
      { title: 'Moving a project off a JSON config file', body: 'Tools that have switched from a .json config to a .toml one need the same settings in the new syntax. Convert once and commit the result, rather than retyping every key by hand.' },
    ],
    faq: [
      { q: 'What happens to an array at the document root?', a: 'TOML requires a table there, so the records are wrapped in a table named items and the wrapper is reported as a warning. A root value that is a string, number or null is refused outright, because there is nothing sensible to wrap.' },
      { q: 'Can a TOML array hold mixed types?', a: 'Yes, and one is written out unchanged: [1, "a", true] survives the conversion. Mixed-type arrays became legal in TOML 1.0, so a parser pinned to an older revision may still reject what comes out.' },
      { q: 'Why is my timestamp a quoted string rather than a date?', a: 'JSON has no date type, so "2024-05-01T00:00:00Z" arrives as text and leaves as text in quotes, not as a TOML offset date-time. Retype the value without quotes afterwards if the reader expects a real date.' },
      { q: 'Why did the key order change?', a: 'Everything written after a [table] header belongs to that table, so plain key-value pairs are emitted first and every table and array of tables after them. Order within each table follows the JSON.' },
    ],
    sample: { input: '{"title":"FormatPort","owner":{"name":"Ada"},"ports":[80,443]}' },
  },

  'toml-to-json': {
    handles: [
      'TOML dates and date-times become ISO 8601 strings.',
      'Tables, inline tables and arrays of tables all become plain JSON objects and arrays.',
      'Invalid TOML reports the line and column rather than a raw parser message.',
    ],
    useCases: [
      { title: 'Reading Cargo.toml from a script', body: 'A Rust project keeps its version and its dependency table in Cargo.toml, which jq and most CI helpers cannot read. As JSON, package.version and the whole dependencies table become ordinary object keys.' },
      { title: 'Pulling values out of pyproject.toml', body: 'Build metadata sits under [project] and tool sections such as [tool.ruff]. Those become nested objects, so a release script can read project.version without a TOML parser on the path.' },
      { title: 'Asserting on netlify.toml redirects', body: 'Each [[redirects]] block becomes one element of a redirects array, so a test can count them and check that every from has a matching to and status.' },
      { title: 'Piping config into a JSON-only tool', body: 'Setting indentation to compact prints the document on a single line, which is the shape to pipe into a command that expects one JSON value on stdin.' },
    ],
    faq: [
      { q: 'How are TOML datetimes represented in JSON?', a: 'An offset date-time keeps its zone as 1979-05-27T07:32:00.000Z, a local date-time drops the trailing Z, a local date stays 1979-05-27 and a local time becomes 07:32:00.000. All four arrive as strings, because JSON has no date type of its own.' },
      { q: 'What happens to inf and nan?', a: 'JSON has neither, so inf, -inf and nan all come out as null.' },
      { q: 'Are hexadecimal, octal and binary integers preserved?', a: 'No. TOML accepts 0xDEADBEEF, 0o755 and 0b1010, but JSON has a single numeric type, so they are written in decimal — 0xDEADBEEF becomes 3735928559.' },
      { q: 'Why was my 64-bit integer refused?', a: 'TOML integers are 64-bit and JavaScript numbers are not. A value such as 9223372036854775807 cannot survive the trip, so the parse stops with "integer value cannot be represented losslessly" rather than quietly rounding it.' },
    ],
    sample: { input: 'title = "FormatPort"\n\n[owner]\nname = "Ada"\nactive = true\n' },
  },

  'json-to-csv': {
    handles: [
      'Columns are the union of every key across all records, in first-seen order.',
      'Records missing a key get an empty cell rather than a shifted row.',
      'Nested objects and arrays are written as JSON text inside a single cell.',
      'The delimiter can be a comma, semicolon, tab or pipe, and the header row can be switched off.',
      'Output always uses "\\n" line endings.',
    ],
    useCases: [
      { title: 'Opening an API response in a spreadsheet', body: 'Paste the array a REST endpoint returned and get a table Excel, Sheets or Numbers will open directly. Pick the semicolon delimiter if your locale of Excel expects one.' },
      { title: 'Sending results to someone without a JSON viewer', body: 'A dump from a log search or an admin endpoint becomes rows a colleague can sort and filter with no tooling beyond a spreadsheet.' },
      { title: 'Preparing a file for a bulk import', body: 'Import forms and data-loading tools usually accept CSV only, so a JSON fixture has to be flattened first. A single object is written as a one-row table.' },
    ],
    faq: [
      { q: 'How are commas, quotes and line breaks escaped?', a: 'A value is wrapped in double quotes when it contains the delimiter, a double quote or a line break, and any double quote inside it is doubled. With the semicolon or tab delimiter selected, a comma inside a value needs no quoting at all.' },
      { q: 'What happens to a JSON null?', a: 'It becomes an empty cell, which is indistinguishable from an empty string or from a key the record never had. Substitute a sentinel value before converting if that difference matters downstream.' },
      { q: 'Does the input have to be an array of objects?', a: 'A single object is accepted and becomes one row, and an envelope such as {"people": [ ... ]} whose one top-level key holds the array is unwrapped for you. An array of strings or numbers is refused, and the error names the record that is not an object.' },
      { q: 'Are values reformatted on the way out?', a: 'No. Booleans are written as true and false, and strings are copied verbatim, so "007" keeps its leading zeros and a date stays in whatever format the JSON already used.' },
    ],
    sample: { input: '[{"id":1,"name":"Ada"},{"id":2,"name":"Linus","role":"maintainer"}]' },
  },

  'csv-to-json': {
    handles: [
      'The delimiter is detected automatically: comma, semicolon, tab or pipe.',
      'A quoted field keeps the commas inside it, and "" is read as an escaped quote.',
      'A file with no header row is detected and its columns are named column1 to columnN.',
      'Values stay strings until "Infer numbers and booleans" is switched on, so "007" survives as text.',
      'A UTF-8 byte order mark is stripped, and header cells are trimmed.',
      'Files above 2 MiB are streamed row by row, up to 100,000 rows.',
    ],
    useCases: [
      { title: 'A spreadsheet export from Excel', body: 'A sheet saved on a European locale comes out semicolon-separated with a byte order mark; paste it as is and the delimiter is worked out for you.' },
      { title: 'Fixtures for an API test', body: 'Keep the test cases as a small CSV that non-developers can edit, and convert to the JSON array your mock server or test file expects.' },
      { title: 'Seed data for a database', body: 'Turn a reference table of countries or plan tiers into an array of objects a migration or seed script can iterate over.' },
      { title: 'A log export with a header row', body: 'Convert an analytics or access-log export into JSON so you can filter and group it with jq rather than awk.' },
    ],
    faq: [
      { q: 'What happens if two columns have the same name?', a: 'The second is renamed with a numeric suffix, so name,name becomes the keys name and name_1. No column is dropped and no value overwrites another.' },
      { q: 'What about a row with more cells than the header?', a: 'The surplus values are collected in a __parsed_extra array on that record and a warning names the row number. A row with too few cells simply omits the trailing keys.' },
      { q: 'Are newlines inside a quoted field kept?', a: 'Yes. A field wrapped in double quotes may span several lines and arrives as one string containing \\n. CRLF endings are normalised to \\n throughout.' },
      { q: 'What does an empty cell become?', a: 'An empty string by default. With "Infer numbers and booleans" switched on it becomes null instead, and in that mode a value like 007 is read as the number 7.' },
    ],
    sample: { input: 'id;name;role\n1;Ada;"engineer, founder"\n2;Linus;maintainer\n' },
  },

  'json-formatter': {
    handles: [
      'Pretty-print with 2 or 4 spaces, or minify to a single line.',
      'A syntax error reports the line and column and a hint for the usual causes.',
      'Key order is preserved, except that keys which are decimal integers move to the front in ascending order — that is how JavaScript objects order their properties.',
    ],
    useCases: [
      { title: 'Reading a response copied from devtools', body: 'Paste the single-line body you copied from the Network tab and get an indented document you can actually scan for the field you were looking for.' },
      { title: 'Packing JSON into an environment variable', body: 'Minify a service-account blob or a config object so it fits on one line in a .env file or a CI secret that only accepts a single value.' },
      { title: 'Finding the error in a hand-edited tsconfig', body: 'When a build fails with a bare parse error, this reports the line and column of the trailing comma or unquoted key that caused it.' },
      { title: 'Normalising a fixture before review', body: 'Re-indent a committed JSON fixture to 2 or 4 spaces so the next diff shows the values that changed rather than the whitespace.' },
    ],
    faq: [
      { q: 'What happens to duplicate keys?', a: 'The last one wins and the earlier value is discarded without a warning, which is what JSON.parse does. {"a":1,"a":2} formats as {"a": 2}.' },
      { q: 'Will a large ID keep all its digits?', a: 'No. Numbers are parsed as IEEE-754 doubles, so an integer past 2^53 is rounded, 1.0 prints as 1 and -0 prints as 0. Keep IDs of that size as strings.' },
      { q: 'Does it accept comments or trailing commas?', a: 'No, the input has to be strict JSON. Comments, single-quoted keys, trailing commas, NaN and several documents pasted one after another are all reported as errors with a position.' },
    ],
    sample: { input: '{"name":"Ada","ports":[80,443],"active":true}' },
  },

  'json-to-typescript': {
    handles: [
      'Emits an interface or a type alias, named from the root type name you choose.',
      'Nested objects become their own named interfaces rather than inline literals.',
      'Unknown and mixed types are written as unknown or any, whichever you select.',
      'Types describe the sample you paste: a field that is never null in the sample is not optional.',
    ],
    useCases: [
      { title: 'Typing an untyped third-party API', body: 'Paste one real response from a service that ships no types and you get an interface tree to code against, instead of scattering any across the call site.' },
      { title: 'Regenerating types after a schema change', body: 'When a response grows or loses a field, generate again from a fresh sample and diff the two files to see exactly what moved.' },
      { title: 'Typing a captured test fixture', body: 'A payload saved as a fixture can be typed from itself, so the day the fixture drifts from the shape the test expects, the compiler says so.' },
      { title: 'Naming the types in a nested payload', body: 'Array elements are named from the singular of their key, so users gives a User interface. A sample that is a top-level array gives an element interface plus an exported alias for the array.' },
    ],
    faq: [
      { q: 'How does it decide a field is optional?', a: 'Only by comparing records in an array: a key present in some elements and missing from others gets a question mark. A single object offers no such evidence, so every key comes out required.' },
      { q: 'What happens with an array of mixed types?', a: 'The element types are merged into a union and parenthesised, so [1, "a", true] becomes (number | string | boolean)[]. An empty array has nothing to observe and becomes unknown[], or any[] if you switch the fallback.' },
      { q: 'What type does a null field get?', a: 'A key that is null in every record is typed null and nothing more, because the sample carries no other information about it. A key that is null in one record and a string in another comes out as string | null.' },
      { q: 'Can it tell a date string from an ordinary string?', a: 'No. An ISO 8601 timestamp is typed string rather than Date, and whole numbers and decimals are both number, since TypeScript has no separate integer type.' },
    ],
    sample: { input: '{"id":1,"name":"Ada","address":{"city":"London"},"tags":["a","b"]}' },
  },

  'json-to-zod': {
    handles: [
      'Emits a Zod schema, with or without the import line.',
      'Whole numbers become z.number().int() when integer inference is on.',
      'Nested objects become nested z.object() calls.',
      'The schema describes the sample you paste; it is not inferred from a wider dataset.',
    ],
    useCases: [
      { title: 'Seeding validation at an API boundary', body: 'Generate a schema from a real upstream response and parse with it inside the fetch wrapper, so a shape change fails at the boundary rather than three components later.' },
      { title: 'Validating a webhook or queue message', body: 'A captured delivery gives the first draft of the safeParse call in the handler, which you then tighten on the fields the handler actually reads.' },
      { title: 'A validator and a type from one sample', body: 'The exported z.infer alias is named after the schema with a trailing "Schema" removed, so UserSchema also gives you a User type and there is nothing to keep in step by hand.' },
    ],
    faq: [
      { q: 'Are nested objects extracted into separate schemas?', a: 'No. Every level is inlined into a single expression, however deep the sample goes, and nothing named is declared below the root. Lift an AddressSchema out by hand if you want to reuse it.' },
      { q: 'Does it recognise emails, UUIDs or ISO dates?', a: 'No. Every string becomes a plain z.string() with no refinement: no .email(), no .uuid(), no .datetime(), and no min, max or length on strings, numbers or arrays. Those are the parts worth adding yourself.' },
      { q: 'How are optional and nullable fields told apart?', a: 'A key missing from some elements of a sample array gets .optional(), and a key seen as null in at least one record gets .nullable(). A key that was null in every record becomes z.null() on its own, since nothing else was ever observed.' },
      { q: 'Are unknown keys rejected?', a: 'No. A plain z.object() is emitted and neither .strict() nor .passthrough() is ever added, so extra keys follow the default Zod behaviour and are stripped instead of raising an issue.' },
    ],
    sample: { input: '{"id":1,"name":"Ada","active":true}' },
  },

  'json-to-python': {
    handles: [
      'Emits @dataclass definitions with type hints, one class per nested object.',
      'Keys that are not valid Python identifiers are skipped and listed in a comment.',
      'Null values in the sample produce Optional fields.',
    ],
    useCases: [
      { title: 'Writing a client for a REST endpoint', body: 'A captured response becomes @dataclass definitions to hang a hand-written client off, with each nested class defined above the class that refers to it.' },
      { title: 'Modelling a webhook payload', body: 'One delivered body gives you the classes to type the handler signature with, instead of reading keys out of a dict and guessing which of them are always present.' },
      { title: 'Moving a script off raw dictionaries', body: 'A script that indexes into data["items"][0]["id"] can be lifted onto generated classes, so a renamed key becomes a type error rather than a KeyError at runtime.' },
    ],
    faq: [
      { q: 'Can it emit TypedDict, Pydantic or attrs models?', a: 'No, only standard-library @dataclass definitions with typing hints. Nothing is validated at runtime; the output is a typed container, not a parser.' },
      { q: 'Why are the attributes in a different order from the JSON?', a: 'Optional and nullable fields are given a default of None, and Python requires defaulted fields to come last, so they are moved to the end of the class. Constructing an instance positionally therefore does not follow the original key order.' },
      { q: 'Are the original key names kept?', a: 'Attribute names are converted to snake_case, so lastSeen becomes last_seen and HTTPStatus becomes http_status. No metadata mapping an attribute back to its JSON key is emitted, so a from_dict loader has to apply the rename itself.' },
      { q: 'How are numbers typed?', a: 'A whole number in the sample becomes int and a fractional one becomes float, so a price that happens to be 10 in your sample is typed int even though the endpoint can return 10.5. Only a position that held genuinely different types produces Union, as in Union[int, str].' },
    ],
    sample: { input: '{"id":1,"name":"Ada","manager":null}' },
  },

  'json-to-go': {
    handles: [
      'Emits Go structs with JSON tags matching the original key names.',
      'The package line and omitempty tags can each be switched off.',
      'Nested objects become their own named structs.',
      'Pointer types are not generated. A key that was null in every record becomes interface{}; a key null in only some keeps its type and gains omitempty.',
    ],
    useCases: [
      { title: 'Unmarshalling a response you only have a sample of', body: 'The tag on each field carries the original key spelling, so encoding/json binds created_at or first-name to an exported Go field without any further mapping.' },
      { title: 'Field names a Go reviewer will accept', body: 'Known initialisms are capitalised in full, so user_id becomes UserID, apiURL becomes APIURL and ipAddress becomes IPAddress — the spelling revive and golint ask for, rather than UserId.' },
      { title: 'Finding out which fields are really optional', body: 'Paste an array of two or three captured responses instead of one. A key missing from some of them is the only evidence of optionality available, and it is what puts omitempty on that field.' },
      { title: 'Pasting into a file that already exists', body: 'Switching the package clause off emits the type declarations alone, so they drop into a models file that already has its own package line and imports.' },
    ],
    faq: [
      { q: 'How do I tell an absent field from a null one?', a: 'With these types you cannot: both unmarshal to the zero value, so an empty string is indistinguishable from a key the server never sent. Change that field to a pointer, or to json.RawMessage, where the difference carries meaning.' },
      { q: 'What type does a timestamp or a price get?', a: 'A date string is typed string; time.Time is never emitted, so add it along with the parsing yourself. A whole number becomes int and a fractional one float64, so a price that happens to be 10 in the sample is typed int even though the endpoint can return 10.5.' },
      { q: 'What do I get from a top-level JSON array?', a: 'Only the struct for the element, named after your root name with a 2 appended because the root name is already taken. No named slice type is declared, so write []Root2 at the call site.' },
      { q: 'How are empty or mixed values typed?', a: 'An empty array becomes []interface{} and an empty object map[string]interface{}. An array whose elements are of different types also collapses to []interface{}, since a single slice type has to cover all of them.' },
    ],
    sample: { input: '{"id":1,"name":"Ada","active":true}' },
  },

  'json-to-sql': {
    handles: [
      'Emits CREATE TABLE for PostgreSQL or SQLite from a flat object or an array of similar objects.',
      'Nested objects and arrays are stored as JSONB on PostgreSQL and TEXT on SQLite.',
      'Column types come from the sample; widths, indexes, constraints and foreign keys are not inferred.',
      'Identifiers are escaped for the selected dialect.',
    ],
    sample: { input: '[{"id":1,"name":"Ada","active":true}]' },
  },

  'json-to-json-schema': {
    handles: [
      'Emits draft-07 or 2020-12.',
      'Required lists the keys that appear in every observed object.',
      'additionalProperties can be pinned to false.',
      'Array items are merged across every element, so a mixed array gets a list of types.',
    ],
    useCases: [
      { title: 'Failing the build when a payload changes', body: 'Generate from a recorded request body, commit the schema, and validate against it with ajv or check-jsonschema in a pipeline step so a contract change is caught there instead of in an integration test.' },
      { title: 'An entry under components/schemas', body: 'OpenAPI 3.1 uses the 2020-12 dialect, so select that draft and delete the $schema line before pasting. For 3.0, a type array such as ["string", "null"] has to be rewritten using nullable.' },
      { title: 'Catching typos in a config file', body: 'Forbidding additional properties makes an unrecognised key an error rather than something quietly ignored, and it is applied to every object in the document, not only the outermost one.' },
      { title: 'Autocomplete while editing JSON by hand', body: 'Point an editor at the generated file through a $schema key or a workspace setting and it will complete property names and underline the ones that do not belong.' },
    ],
    faq: [
      { q: 'How do I get a required list I can trust?', a: 'Feed it an array of records. A key is required when it was present in every object observed at that position, so a single sample makes all of its keys required simply because nothing contradicted them.' },
      { q: 'Does it infer format, enum or length constraints?', a: 'No. Every string is {"type": "string"} with no format, pattern, minLength or enum, and numbers get no minimum or maximum. An email, a UUID and an ISO timestamp are therefore indistinguishable in the output.' },
      { q: 'How is an array of mixed values typed?', a: 'Every element is taken into account, not just the first: [1, "a", null] produces "type": ["integer", "string", "null"], and a position that mixes objects with arrays produces an anyOf that is usually broader than the real contract.' },
      { q: 'What differs between the two drafts on offer?', a: 'Only the $schema URI. The same keywords are emitted either way — no prefixItems, no $defs and no $ref — and every nested schema is written out in place, so a shape repeated twice appears twice.' },
    ],
    sample: { input: '[{"id":1,"name":"Ada"},{"id":2,"name":"Linus"}]' },
  },

  'jwt-decoder': {
    handles: [
      'Splits the token on its dots and base64url-decodes the header and the payload.',
      'The signature is shown but never verified — verification needs the signing key.',
      'Registered claims such as exp, iat and nbf are shown as readable dates alongside their raw values.',
      'A malformed segment is reported rather than guessed at.',
    ],
    useCases: [
      { title: 'Chasing down a 401 from an API', body: 'Paste the token exactly as it appears in the Authorization header — a leading "Bearer " is stripped for you — and read the sub, aud and scope values the API is actually receiving.' },
      { title: 'Telling an expiry apart from a permissions problem', body: 'Beside the raw exp the decoder prints either how long the token remains valid or an EXPIRED marker, which settles in one glance whether the call failed because the token lapsed.' },
      { title: 'Tracking down which key signed a token', body: 'The header\'s kid is lifted out onto its own line, so it can be matched against an entry in your JWKS when a key rotation has left services disagreeing.' },
      { title: 'Spotting a malformed or unsigned token', body: 'An alg of "none" is flagged as unsigned and therefore untrusted. Input that does not split into exactly three segments is rejected with the count that was found, which usually means the token was truncated in transit.' },
    ],
    faq: [
      { q: 'Why does decoding a JWT not tell me it is valid?', a: 'Decoding reverses the base64url encoding and nothing else: it reports what the token claims, not whether those claims are genuine. Confirming that requires the issuer\'s signing key to recompute the signature, and this tool has no key and requests none, so it never verifies.' },
      { q: 'Is the payload encrypted?', a: 'No. A signed JWT is encoded, not encrypted, so anyone who gets hold of the token can read every claim in it. Nothing secret belongs in a payload.' },
      { q: 'What is the kid header for?', a: 'It names the key the issuer signed with, so a verifier can select the right entry from a JWKS while several keys are live. It is a hint from the token itself, so a verifier must still pin the algorithm it expects instead of trusting the header.' },
      { q: 'Are exp and iat in seconds or milliseconds?', a: 'Seconds since the epoch, as RFC 7519 requires, which makes them ten digits today. Code that passes a millisecond value straight in produces a token that claims to expire thousands of years from now.' },
    ],
    sample: { input: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjoxNzE2MjM5MDIyfQ.dummy-signature-not-verified' },
  },

  'base64-encoder-decoder': {
    handles: [
      'Encodes and decodes standard Base64 and the URL-safe alphabet that uses - and _.',
      'Padding with = can be switched off when encoding.',
      'Text is treated as UTF-8, so non-ASCII characters survive a round trip.',
      'Decoding accepts input with or without padding.',
    ],
    useCases: [
      { title: 'Assembling a data: URI', body: 'An inline SVG or a small JSON payload in CSS or a src attribute goes after the media type as standard padded Base64. The input is text, so it encodes markup and strings rather than a binary file you drop on it.' },
      { title: 'Reading an HTTP Basic auth header', body: 'The value after "Basic" is user:password in standard Base64 — decoding one tells you which account a stored credential or a captured request belongs to.' },
      { title: 'Binary fields carried inside JSON', body: 'JSON has no byte type, so APIs pass certificates, keys and thumbnails as Base64 strings. Decoding one that really holds binary stops with a message saying so, because the output pane is text.' },
      { title: 'A Base64 block copied out of a raw email', body: 'MIME wraps attachment bodies at 76 characters. All whitespace is removed before decoding, so a block pasted straight from the message source works without rejoining the lines.' },
    ],
    faq: [
      { q: 'What is the difference between Base64 and base64url?', a: 'Only the last two symbols: base64url writes "-" and "_" where standard Base64 writes "+" and "/", so the result survives inside a URL path, a query string or a JWT segment untouched. The alphabet option picks which one to emit; decoding accepts either without being told.' },
      { q: 'Does the "=" padding matter?', a: 'Not for decoding here — padding is stripped first and unpadded input is accepted. It matters for stricter parsers: JWT segments are always unpadded, while a data: URI or an Authorization header normally carries the padding.' },
      { q: 'Does Base64 protect anything?', a: 'No. It is a transport encoding that anyone can reverse, so a Basic auth header is effectively a plaintext credential and a Base64 blob in a config file hides nothing from whoever can read the file.' },
      { q: 'Why is the output longer than the input?', a: 'Every three bytes become four characters, so the result grows by about a third. Multi-byte characters count as their UTF-8 bytes: "Z" with a caron is two bytes before encoding even though it is one character.' },
    ],
    sample: { input: 'Žofie & Ada', options: { direction: 'encode' } },
  },

  'url-encoder-decoder': {
    handles: [
      'Detects what to do with the input: an absolute URL is inspected, text carrying percent escapes is decoded, anything else is encoded.',
      'Encoding uses encodeURIComponent for a single value or encodeURI for a whole URL.',
      '"+" can be treated as a space when decoding, which is the form-submission rule.',
      'Inspecting a URL breaks out protocol, host, port, path, query parameters and hash.',
    ],
    useCases: [
      { title: 'One value going into a query string', body: 'Component scope escapes &, = and / inside the value, which is what stops a search term or a filter expression from ending the parameter early.' },
      { title: 'Reading the redirect_uri out of an authorize URL', body: 'Inspecting an OAuth URL decodes each parameter once, so redirect_uri and scope come back readable. A value that is still full of escapes afterwards was encoded twice on the way in.' },
      { title: 'A link that only needs its spaces fixed', body: 'Whole-URL scope leaves : / ? # & = alone and escapes only what is illegal, which is the right treatment for an address pasted out of a document or a chat message.' },
      { title: 'A form body copied from the network tab', body: 'An application/x-www-form-urlencoded body writes spaces as +, so switch the plus option on before decoding it — and leave it off for a path segment, where + is an ordinary character.' },
    ],
    faq: [
      { q: 'Why are ! \' ( ) * ~ left unescaped?', a: 'encodeURIComponent exempts them, along with letters, digits and - . _ , and they are legal in a query value. A stricter consumer, such as an RFC 3986 or OAuth 1.0 signature, wants them escaped, so percent-encode those few by hand.' },
      { q: 'Is a space %20 or a plus?', a: 'Encoding here always produces %20. A plus means a space only under the form-submission rules, which is why decoding it that way is an explicit option rather than the default.' },
      { q: 'Why did decoding leave some escapes behind?', a: 'Whole-URL scope refuses to decode the escapes that stand for reserved characters — %2F, %3F, %26 and the rest — because doing so would change how the address parses. Switch to component scope to decode everything.' },
      { q: 'Why does the parameter count exceed the number of keys shown?', a: 'The count covers every name-value pair, while the parsed object holds one entry per name. With ?tag=a&tag=b it counts two and shows tag once, with the last value winning, so check the raw query string when repeated keys matter.' },
    ],
    sample: { input: 'hello world&lang=cs' },
  },

  'curl-to-code': {
    handles: [
      'Translates one cURL invocation into JavaScript fetch, axios or Python requests.',
      'Understands quoting, backslash escapes and backslash line continuations.',
      'Shell expansion is not evaluated — $VAR, ${VAR}, $(...) and backticks pass through as literal text.',
      'Pipes, redirections, subshells, && chains and multiple URLs are not translated.',
      'Transport-only flags such as -s, -v, -k and --compressed are listed rather than converted.',
    ],
    sample: { input: "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"Ada\"}'" },
  },

  'hash-generator': {
    handles: [
      'SHA-256, SHA-384, SHA-512, SHA-1 and MD5, printed as lowercase or uppercase hex.',
      'SHA-256 is 64 hex characters, SHA-512 is 128, SHA-1 is 40 and MD5 is 32.',
      'SHA family digests come from the browser\'s own Web Crypto API; MD5 comes from a bundled library.',
      'A file is hashed from its bytes rather than its text, so any file type works.',
      'MD5 and SHA-1 are marked in the options: both are broken for collision resistance and unfit for signatures or passwords.',
    ],
    useCases: [
      { title: 'Verifying a download against its checksum', body: 'Drop the file onto the input and compare the SHA-256 digest with the one the project publishes next to the release. A file larger than 10 MiB is declined rather than read.' },
      { title: 'Proving two files are byte-identical', body: 'Hash each one and compare the hex: matching SHA-256 digests mean the bytes match, including anything a visual diff would not show. Tick several algorithms to get every digest from one pass over the input.' },
      { title: 'Matching a vendor list printed in capitals', body: 'Hex digests are often published uppercase, and a string comparison cares. "Uppercase output" reprints the same digest in capitals so the two lines can be diffed directly.' },
      { title: 'Content addressing and ETag values', body: 'The same bytes always produce the same digest, which is what makes a hash usable as a cache key, an ETag or a deduplication key for stored objects.' },
    ],
    faq: [
      { q: 'Is hashing the same as encryption?', a: 'No. A hash takes no key and runs one way only: it maps any input to a fixed-length digest, and no operation turns that digest back into the original bytes. Encryption is reversible by whoever holds the key.' },
      { q: 'Is MD5 safe for storing passwords?', a: 'No, and nor is plain SHA-256. Both are built to be fast, which is exactly what someone guessing billions of passwords wants; password storage needs a slow salted function such as argon2, scrypt or bcrypt.' },
      { q: 'Can I still use MD5 or SHA-1 for anything?', a: 'Only as a non-adversarial checksum — catching a corrupted transfer, or matching a value a legacy system already stores. Collisions can be manufactured on demand for both, MD5 in seconds and SHA-1 since the 2017 SHAttered attack, so neither proves that a file has not been tampered with.' },
      { q: 'Why does my digest differ from the one I was given?', a: 'Hashing covers exact bytes, so a trailing newline, CRLF line endings or a stray space changes the result completely. That is the usual cause when two people hash what looks like the same pasted text.' },
    ],
    sample: { input: 'hello world', options: { algorithms: ['sha256', 'sha512', 'md5'] } },
  },

  'unix-timestamp-converter': {
    handles: [
      'Seconds, milliseconds and microseconds are told apart by digit count, or can be forced.',
      'Shows ISO 8601, UTC, a chosen time zone, and how long ago the instant is.',
      '10 digits is seconds, 13 is milliseconds, 16 is microseconds.',
      'Converts in both directions: a timestamp to a date, or a date back to a timestamp.',
    ],
    useCases: [
      { title: 'Reading an epoch out of a log line', body: 'Syslog, nginx and most JSON loggers write a bare number rather than a date. Pasting it gives you ISO 8601 in UTC, the same instant in a named zone such as Europe/Prague, and the day of the week.' },
      { title: 'A 13-digit value from Date.now()', body: 'JavaScript counts in milliseconds, so anything that came out of Date.now() or getTime() has three more digits than a backend timestamp. Both readings are printed either way, so a mismatched unit is obvious.' },
      { title: 'Checking a JWT exp or iat claim', body: 'Both claims are Unix seconds, so they arrive as ten digits. Paste the raw claim to see when the token was issued or when it lapsed.' },
      { title: 'Comparing a database column with wall-clock time', body: 'Postgres and several tracing formats emit microsecond epochs of sixteen digits. Typing a date back the other way, such as 2024-05-01 12:00, reads it in the zone chosen under "Time zone" rather than the browser\'s.' },
    ],
    faq: [
      { q: 'Is a Unix timestamp in seconds or milliseconds?', a: 'The epoch is defined in seconds, and that is what backends, database columns and JWT claims normally store. Milliseconds are a JavaScript convention; both values are printed on every conversion so you can copy whichever the other system wants.' },
      { q: 'What unit is an 18-digit number?', a: 'Nanoseconds, which is what Go\'s UnixNano and some tracing pipelines produce. "Interpret numbers as" offers seconds, milliseconds and microseconds for forcing a reading; nanoseconds are reached by auto-detection only.' },
      { q: 'Which zone is a date without an offset read in?', a: 'The one selected under "Time zone", not the machine\'s. That deliberately differs from Date.parse, which reads "2024-05-01" as UTC but "2024-05-01T12:00" as local time.' },
      { q: 'Does it handle dates before 1970 and fractional seconds?', a: 'Yes to both. A negative number is an instant before the epoch, so -1000000 resolves to 20 December 1969, and 1700000000.5 keeps its half second in the ISO output.' },
    ],
  },

  'uuid-generator': {
    handles: [
      'Generates version 4 UUIDs from crypto.randomUUID(), falling back to crypto.getRandomValues outside a secure context. Both draw on the operating system\'s random source.',
      '1, 10 or 100 at a time, lowercase or uppercase.',
      'Version 4 carries no timestamp and no MAC address, and sorts randomly.',
    ],
    useCases: [
      { title: 'Filling a fixture or a seed script', body: 'Ask for a hundred at once and they arrive one per line, ready to paste into a factory file, a migration or a column of test data.' },
      { title: 'Ids minted before anything reaches the server', body: 'An offline-first client, or a retry that needs a stable idempotency key, has to name a record without asking a database for the next number. 122 random bits make a clash between two clients not worth planning for.' },
      { title: 'A correlation id for a request you are replaying', body: 'Paste one into an X-Request-Id header on a hand-built curl call and the same value traces that single call through every log line it touches.' },
    ],
    faq: [
      { q: 'Which UUID versions does this produce?', a: 'Version 4 only. There is no v1, v5 or v7 here and no nil UUID; if you want identifiers that sort by creation time, use the ULID tool or a UUIDv7 implementation in your own language.' },
      { q: 'Where does the randomness come from?', a: 'crypto.randomUUID, which draws on the platform\'s cryptographic random source rather than Math.random. Six of the 128 bits are fixed to mark the version and the variant, leaving 122 random ones. Outside a secure context the same bits come from crypto.getRandomValues with those markers set explicitly.' },
      { q: 'Why do these behave badly as a database key?', a: 'Two values generated a moment apart share no leading digits, so rows scatter across the whole index instead of landing together, and ordering by the column tells you nothing about when anything was written.' },
      { q: 'Can I get them without hyphens or inside braces?', a: 'No. The output is always the canonical 8-4-4-4-12 hyphenated form, one per line, and case is the only formatting choice. Strip the hyphens or add braces afterwards for a registry-style GUID.' },
    ],
  },

  'ulid-generator': {
    handles: [
      'Generates ULIDs: 26 Crockford base32 characters, a 48-bit timestamp followed by 80 random bits.',
      'Lexicographic order matches creation order, which is what makes them usable as database keys.',
      'Monotonic mode guarantees ordering within the same millisecond.',
      '1, 10 or 100 at a time.',
    ],
    useCases: [
      { title: 'Primary keys in an insert-heavy table', body: 'Random identifiers scatter inserts across the whole of a B-tree index. ULIDs ascend, so new rows land at the right-hand edge of the index the way an auto-increment key does.' },
      { title: 'Event ids that sort chronologically', body: 'Ordering an event table by its id column reproduces the order the events were written, which can save a secondary index on a created_at column.' },
      { title: 'Seeding fixtures with ordered ids', body: 'Generate a block of ids in one go and paste it straight into a fixture file. Sorting that column afterwards gives the same order back, which makes snapshot assertions stable.' },
      { title: 'Choosing between ULID and UUIDv7', body: 'Both put the same 48-bit millisecond timestamp first and both sort by time. UUIDv7 is a genuine UUID — 36 hyphenated hex characters, registered in RFC 9562 — while a ULID is a 26-character token that a UUID column or library will not accept.' },
    ],
    faq: [
      { q: 'Why are two ULIDs made in the same millisecond out of order?', a: 'They share their first ten characters and differ only in the random tail, so their relative order within that millisecond is arbitrary. Monotonic mode is what removes the ambiguity.' },
      { q: 'How does a ULID differ from a UUID v4?', a: 'A v4 UUID is 122 random bits with no time component, so two ids created a second apart sort no closer together than two created a year apart. A ULID also carries no hyphens, so it survives a URL or a filename without escaping.' },
      { q: 'Why Crockford base32 rather than base64?', a: 'The alphabet leaves out I, L, O and U, so a ULID cannot be misread as a look-alike character or spell an unfortunate word, and it decodes case-insensitively.' },
      { q: 'Where do the random bits come from?', a: 'From crypto.getRandomValues, the platform CSPRNG, not Math.random — the ULID library\'s own random source is replaced with an explicit Web Crypto one so it behaves the same in every context.' },
    ],
  },

  'case-converter': {
    handles: [
      'camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, dot.case, Title Case, Sentence case, lower and UPPER.',
      'Shows every style at once for the first non-empty line, or converts every line when you pick a single style.',
      'Each line can be converted separately, so a whole list of identifiers can be pasted in.',
      'Existing casing, underscores, hyphens, dots and spaces are all read as word boundaries.',
    ],
    useCases: [
      { title: 'Renaming a block of API fields', body: 'Paste the keys of a response as one column and pick snake_case or camelCase; the list comes back in its original order, with blank lines left where they were.' },
      { title: 'Environment variables from a settings path', body: 'CONSTANT_CASE turns database.pool.size or databasePoolSize into DATABASE_POOL_SIZE, which is the spelling a .env file or a container env block needs.' },
      { title: 'Slugs for routes, classes and filenames', body: 'kebab-case gives the form a URL segment, a CSS class or a documentation filename wants, from a title or an identifier that was written in any other style.' },
      { title: 'Seeing what a rename will really produce', body: 'Showing every style prints all ten results for the first non-empty line, so an awkward case — HTTPStatus arriving as httpStatus — is visible before you apply it across a codebase.' },
    ],
    faq: [
      { q: 'How are acronyms handled?', a: 'A run of capitals is one word, so HTTPStatus splits into HTTP and Status and parseJSONValue into parse, JSON and Value. CONSTANT_CASE restores them exactly, while camelCase and PascalCase lowercase all but the first letter, which makes a Pascal round trip give HttpStatus rather than HTTPStatus.' },
      { q: 'Where do digits create a word boundary?', a: 'A run of digits is always its own word, so utf8Value gives utf_8_value and order99 gives order_99. camelCase and PascalCase join words without a separator, so utf8Value converts back to itself.' },
      { q: 'What happens to punctuation and other symbols?', a: 'Anything that is neither a letter nor a number is treated as a separator and does not survive: a.b, a-b and a b all produce the same two words, and an ampersand or an emoji is dropped. A line holding nothing else comes out empty.' },
      { q: 'Does it cope with non-ASCII identifiers?', a: 'Yes — word splitting uses Unicode letter and number classes, so čeština and größe are not shredded. Case mapping follows the same rules, which means CONSTANT_CASE writes größe as GRÖSSE and that particular change cannot be undone by converting back.' },
    ],
    sample: { input: 'user_first_name', options: { style: 'all', perLine: true } },
  },

  'regex-tester': {
    handles: [
      'Matches or replaces, with the g, i, m, s, u, v, y and d flags.',
      'Shows every match with its index and its capture groups.',
      'The pattern runs in a Web Worker that is killed after 750 ms, so catastrophic backtracking cannot freeze the tab.',
      'Replacement supports $1, $2 and named group references.',
    ],
    useCases: [
      { title: 'Building a log-parsing pattern', body: 'Paste two or three real log lines and grow the pattern one field at a time. The highlighted copy of the input shows which characters each match actually consumed, so a greedy quantifier that ran past a field boundary is visible rather than guessed at.' },
      { title: 'Checking a validation rule', body: 'Put the strings the rule must accept and the ones it must reject into a single block, then read off which get highlighted — testing only the accepted cases is how an over-permissive rule ships.' },
      { title: 'Naming capture groups', body: 'Write (?<level>ERROR|WARN) and the results table labels that column level instead of 1, matching what match.groups gives you in code. A group that took no part in a match is listed as (no match).' },
      { title: 'Reproducing a ReDoS report', body: 'Paste the suspect pattern together with the attack string: if the run is cut short, that pattern really does backtrack catastrophically on that input. Nested quantifiers such as (a+)+ are the usual cause.' },
    ],
    faq: [
      { q: 'Which regex flavour does this use?', a: 'The browser\'s own ECMAScript engine, through the RegExp constructor. Constructs that exist only in PCRE — atomic groups, possessive quantifiers, recursion — are not available here.' },
      { q: 'Do I write the pattern with slashes, like /foo/g?', a: 'No. The pattern field takes the body of the expression alone and flags are a separate control, so a leading and trailing slash would be matched as literal characters.' },
      { q: 'Why does it find only one match?', a: 'Without the g flag a JavaScript regular expression returns the first match and stops — that is engine behaviour, not a limit of the tool. Add g to the flags field to find them all.' },
      { q: 'How many matches does it list?', a: 'Up to 1000, after which the list is cut and the summary is marked truncated. Find and replace is not capped the same way: every occurrence is replaced, and the reported count is exact up to 100,000.' },
    ],
    sample: {
      input: 'ERROR order=8821 status=timeout\nWARN order=8822 status=retry',
      options: { pattern: '^(?<level>ERROR|WARN) order=(?<id>\\d+)', flags: 'gm' },
    },
  },

  'diff-checker': {
    handles: [
      'Compares by line, by word, or semantically as JSON where key order does not count as a change.',
      'Side-by-side or unified view.',
      'Whitespace-only and case-only differences can each be ignored.',
      'Additions and removals carry a glyph as well as a colour.',
    ],
    useCases: [
      { title: 'Reviewing a config change', body: 'Paste the running config beside the proposed one; the counts above the table — added, removed, unchanged — give you the size of the change before you read a line of it.' },
      { title: 'Comparing two API responses', body: 'Staging and production often serialise the same object with the keys in a different order. JSON mode normalises that away, but element order inside an array is data and still shows as a change.' },
      { title: 'Finding a whitespace-only edit', body: 'When a file reads as identical but the tooling insists it changed, compare with ignore-whitespace off to locate the reindented lines, then switch it on to confirm nothing else moved.' },
      { title: 'Minified against formatted output', body: 'A minified bundle compared to its pretty-printed form is a single changed line in line mode and tells you nothing. JSON mode reduces the same pair to the values that genuinely differ.' },
    ],
    faq: [
      { q: 'Does the diff ignore whitespace?', a: 'Not unless you ask it to. With ignore-whitespace on, leading and trailing whitespace stops counting, but a change to spacing inside a line is still reported. Word mode keeps spacing inside its own tokens, so the option only affects line and JSON mode.' },
      { q: 'Will it show a CRLF versus LF difference?', a: 'No. Both sides are normalised to \\n before anything is compared, so a file converted from Windows to Unix line endings and nothing else reads as identical.' },
      { q: 'Can I apply the output as a patch?', a: 'It is a standard unified diff with three lines of context, the same default as git diff, but the file headers are fixed as left and right — relabel them before handing it to git apply.' },
      { q: 'What are the limits on size?', a: 'A comparison stops after 5000 changed chunks and says it was truncated. Either side above 2 MiB is still accepted, with a warning that diffing and rendering will be slow.' },
    ],
    sample: {
      input: 'jobs:\n  build:\n    runs-on: ubuntu-22.04\n    steps:\n      - run: npm test\n',
      secondaryInput: 'jobs:\n  build:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm ci\n      - run: npm test\n',
    },
  },
};

/**
 * SEARCH_INTENT — the query a person is most plausibly typing when they should
 * land on a given tool, plus how hard that query is to win.
 *
 * This is editorial judgement, not measured data. It exists so
 * SEO_INDEX_INVENTORY.md can be regenerated instead of hand-maintained, and so
 * the "which pages do we push first" decision is written down somewhere
 * reviewable rather than re-argued each time. Once Search Console has real
 * query data, that data wins over anything guessed here.
 *
 * tier:
 *   1  high-volume, obvious intent — worth requesting indexing for on day one
 *   2  real demand, narrower or more competitive
 *   3  low volume or long-tail; indexed, but not worth pushing
 */
export const SEARCH_INTENT = {
  'format-converter': { query: 'convert json to yaml / csv / toml / xml (any pair)', tier: 2 },
  'json-to-yaml': { query: 'json to yaml converter', tier: 1 },
  'yaml-to-json': { query: 'yaml to json converter', tier: 1 },
  'json-to-toml': { query: 'json to toml converter', tier: 3 },
  'toml-to-json': { query: 'toml to json converter', tier: 3 },
  'json-to-csv': { query: 'json to csv converter', tier: 1 },
  'csv-to-json': { query: 'csv to json converter', tier: 1 },
  'json-formatter': { query: 'json formatter / json beautifier / json validator', tier: 1 },
  'json-to-typescript': { query: 'json to typescript interface generator', tier: 1 },
  'json-to-zod': { query: 'json to zod schema generator', tier: 2 },
  'json-to-python': { query: 'json to python dataclass / typeddict', tier: 2 },
  'json-to-go': { query: 'json to go struct generator', tier: 2 },
  'json-to-sql': { query: 'json to sql insert / create table', tier: 2 },
  'json-to-json-schema': { query: 'generate json schema from json', tier: 2 },
  'jwt-decoder': { query: 'jwt decoder / decode jwt token', tier: 1 },
  'base64-encoder-decoder': { query: 'base64 encode decode online', tier: 1 },
  'url-encoder-decoder': { query: 'url encode decode / percent encoding', tier: 2 },
  'curl-to-code': { query: 'convert curl to python / javascript / go', tier: 2 },
  'hash-generator': { query: 'sha256 / md5 hash generator online', tier: 1 },
  'unix-timestamp-converter': { query: 'unix timestamp converter / epoch converter', tier: 1 },
  'uuid-generator': { query: 'uuid generator v4 online', tier: 2 },
  'ulid-generator': { query: 'ulid generator online', tier: 3 },
  'case-converter': { query: 'camelcase / snake_case converter', tier: 2 },
  'regex-tester': { query: 'regex tester javascript online', tier: 2 },
  'diff-checker': { query: 'text diff checker / compare two texts', tier: 2 },
};
