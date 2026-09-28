; C# locals for Coderimpact: parameters and local variables resolve to their
; declaration inside the method. References are listed per expression position
; so that member names (obj.Name, this.name) never bind to a local.

; Scopes

(class_declaration) @local.scope
(struct_declaration) @local.scope
(record_declaration) @local.scope
(method_declaration) @local.scope
(constructor_declaration) @local.scope
(local_function_statement) @local.scope
(lambda_expression) @local.scope
(accessor_declaration) @local.scope
(block) @local.scope
(for_statement) @local.scope
(foreach_statement) @local.scope
(catch_clause) @local.scope
(using_statement) @local.scope
(switch_section) @local.scope

; Definitions

(parameter name: (identifier) @local.definition)

(lambda_expression parameters: (implicit_parameter) @local.definition)

(local_declaration_statement
  (variable_declaration
    (variable_declarator name: (identifier) @local.definition)))

(for_statement
  (variable_declaration
    (variable_declarator name: (identifier) @local.definition)))

(using_statement
  (variable_declaration
    (variable_declarator name: (identifier) @local.definition)))

(foreach_statement left: (identifier) @local.definition)

(catch_declaration name: (identifier) @local.definition)

(declaration_expression name: (identifier) @local.definition)

(declaration_pattern name: (identifier) @local.definition)

; References (expression positions only)

(argument (identifier) @local.reference)
(binary_expression (identifier) @local.reference)
(assignment_expression (identifier) @local.reference)
(return_statement (identifier) @local.reference)
(throw_statement (identifier) @local.reference)
(parenthesized_expression (identifier) @local.reference)
(conditional_expression (identifier) @local.reference)
(prefix_unary_expression (identifier) @local.reference)
(postfix_unary_expression (identifier) @local.reference)
(cast_expression value: (identifier) @local.reference)
(is_pattern_expression expression: (identifier) @local.reference)
(variable_declarator "=" . (identifier) @local.reference)
(member_access_expression expression: (identifier) @local.reference)
(conditional_access_expression (identifier) @local.reference)
(element_access_expression expression: (identifier) @local.reference)
(bracketed_argument_list (argument (identifier) @local.reference))
(initializer_expression (identifier) @local.reference)
(foreach_statement right: (identifier) @local.reference)
(lambda_expression body: (identifier) @local.reference)
(arrow_expression_clause (identifier) @local.reference)
(interpolation (identifier) @local.reference)
(switch_statement value: (identifier) @local.reference)
(switch_expression (identifier) @local.reference)
(if_statement condition: (identifier) @local.reference)
(while_statement condition: (identifier) @local.reference)
