; Locals for Rust: parameters, let bindings, closures, loop and match patterns.

; Scopes

(function_item) @local.scope
(closure_expression) @local.scope
(block) @local.scope
(for_expression) @local.scope
(match_arm) @local.scope
(if_expression) @local.scope
(while_expression) @local.scope

; Definitions

(parameter pattern: (identifier) @local.definition)
(parameter pattern: (mut_pattern (identifier) @local.definition))
(parameter pattern: (reference_pattern (identifier) @local.definition))
(parameter pattern: (tuple_pattern (identifier) @local.definition))
(closure_parameters (identifier) @local.definition)
(closure_parameters (parameter pattern: (identifier) @local.definition))

(let_declaration pattern: (identifier) @local.definition)
(let_declaration pattern: (mut_pattern (identifier) @local.definition))
(let_declaration pattern: (tuple_pattern (identifier) @local.definition))
(let_declaration pattern: (reference_pattern (identifier) @local.definition))
(let_condition pattern: (tuple_struct_pattern (identifier) @local.definition))

(for_expression pattern: (identifier) @local.definition)
(for_expression pattern: (tuple_pattern (identifier) @local.definition))
(for_expression pattern: (reference_pattern (identifier) @local.definition))

(match_arm pattern: (match_pattern (identifier) @local.definition))
(match_arm pattern: (match_pattern (tuple_struct_pattern (identifier) @local.definition)))
(tuple_struct_pattern (identifier) @local.definition)
(field_pattern (shorthand_field_identifier) @local.definition)
(field_pattern pattern: (identifier) @local.definition)

; References

(identifier) @local.reference
