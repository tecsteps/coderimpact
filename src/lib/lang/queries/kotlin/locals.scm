; Kotlin locals: written for Coderimpact. Parameters and local variables
; resolve to their declaration inside the function. References are listed per
; expression position so that member names (obj.name) never bind to a local.

; Scopes

(class_declaration) @local.scope
(function_declaration) @local.scope
(secondary_constructor) @local.scope
(anonymous_function) @local.scope
(lambda_literal) @local.scope
(block) @local.scope
(for_statement) @local.scope
(catch_block) @local.scope
(when_entry) @local.scope

; Definitions

(parameter
  (identifier) @local.definition)

(class_parameter
  (identifier) @local.definition)

(property_declaration
  (variable_declaration
    (identifier) @local.definition))

(property_declaration
  (multi_variable_declaration
    (variable_declaration
      (identifier) @local.definition)))

(for_statement
  (variable_declaration
    (identifier) @local.definition))

(for_statement
  (multi_variable_declaration
    (variable_declaration
      (identifier) @local.definition)))

(lambda_parameters
  (variable_declaration
    (identifier) @local.definition))

(catch_block
  (identifier) @local.definition)

; References (expression positions only)

(value_argument (identifier) @local.reference)
(binary_expression (identifier) @local.reference)
(in_expression (identifier) @local.reference)
(is_expression left: (identifier) @local.reference)
(as_expression left: (identifier) @local.reference)
(assignment (identifier) @local.reference)
(return_expression (identifier) @local.reference)
(throw_expression (identifier) @local.reference)
(parenthesized_expression (identifier) @local.reference)
(if_expression (identifier) @local.reference)
(when_subject (identifier) @local.reference)
(when_entry (identifier) @local.reference)
(unary_expression (identifier) @local.reference)
(index_expression (identifier) @local.reference)
(interpolation (identifier) @local.reference)
(property_declaration (identifier) @local.reference)
(function_body (identifier) @local.reference)
(for_statement (identifier) @local.reference)
(navigation_expression . (identifier) @local.reference)
(block (identifier) @local.reference)
(lambda_literal (identifier) @local.reference)
