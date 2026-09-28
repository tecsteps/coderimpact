; from tree-sitter-javascript
; Scopes
;-------

[
  (statement_block)
  (function_expression)
  (arrow_function)
  (function_declaration)
  (method_definition)
] @local.scope

; Definitions
;------------

(pattern/identifier) @local.definition

(variable_declarator
  name: (identifier) @local.definition)

; Destructured parameters and variables: `({ cart }) => ...`
(shorthand_property_identifier_pattern) @local.definition

; `for (const item of items)`
(for_in_statement
  left: (identifier) @local.definition)

; `catch (err)`
(catch_clause
  parameter: (identifier) @local.definition)

; References
;------------

(identifier) @local.reference

; `{ sku, qty }` in an object literal reads the variables.
(shorthand_property_identifier) @local.reference

; from tree-sitter-typescript
(required_parameter (identifier) @local.definition)
(optional_parameter (identifier) @local.definition)

; Parameters of signatures without a body stay inside the signature.
[
  (method_signature)
  (abstract_method_signature)
  (function_signature)
  (function_type)
  (construct_signature)
  (call_signature)
] @local.scope
