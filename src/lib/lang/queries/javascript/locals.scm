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
