; Java locals for Coderimpact: parameters and local variables resolve to their
; declaration inside the method. References are listed per expression position
; so that member names (obj.name, this.name) never bind to a local.

; Scopes

(method_declaration) @local.scope
(constructor_declaration) @local.scope
(compact_constructor_declaration) @local.scope
(lambda_expression) @local.scope
(block) @local.scope
(for_statement) @local.scope
(enhanced_for_statement) @local.scope
(catch_clause) @local.scope
(try_with_resources_statement) @local.scope
(switch_block_statement_group) @local.scope

; Definitions

(formal_parameter
  name: (identifier) @local.definition)

(spread_parameter
  (variable_declarator
    name: (identifier) @local.definition))

(local_variable_declaration
  declarator: (variable_declarator
    name: (identifier) @local.definition))

(enhanced_for_statement
  name: (identifier) @local.definition)

(catch_formal_parameter
  name: (identifier) @local.definition)

(resource
  name: (identifier) @local.definition)

(lambda_expression
  parameters: (identifier) @local.definition)

(inferred_parameters
  (identifier) @local.definition)

(instanceof_expression
  name: (identifier) @local.definition)

; References (expression positions only)

(argument_list (identifier) @local.reference)
(binary_expression (identifier) @local.reference)
(assignment_expression (identifier) @local.reference)
(return_statement (identifier) @local.reference)
(throw_statement (identifier) @local.reference)
(parenthesized_expression (identifier) @local.reference)
(ternary_expression (identifier) @local.reference)
(update_expression (identifier) @local.reference)
(unary_expression operand: (identifier) @local.reference)
(cast_expression value: (identifier) @local.reference)
(instanceof_expression left: (identifier) @local.reference)
(variable_declarator value: (identifier) @local.reference)
(method_invocation object: (identifier) @local.reference)
(field_access object: (identifier) @local.reference)
(array_access (identifier) @local.reference)
(array_initializer (identifier) @local.reference)
(enhanced_for_statement value: (identifier) @local.reference)
(lambda_expression body: (identifier) @local.reference)
(expression_statement (identifier) @local.reference)
(switch_label (identifier) @local.reference)
(yield_statement (identifier) @local.reference)
(element_value_pair value: (identifier) @local.reference)
