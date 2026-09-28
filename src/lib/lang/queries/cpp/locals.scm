; Locals for C++: parameters, block-scoped variables, range-for and lambdas.

; Scopes

(function_definition) @local.scope
(lambda_expression) @local.scope
(compound_statement) @local.scope
(for_statement) @local.scope
(for_range_loop) @local.scope
(catch_clause) @local.scope

; Parameters of a prototype belong to the prototype only.
(declaration declarator: (function_declarator parameters: (parameter_list) @local.scope))
(field_declaration declarator: (function_declarator parameters: (parameter_list) @local.scope))

; Function-like macro parameters
(preproc_function_def) @local.scope
(preproc_params (identifier) @local.definition)

; Definitions

(parameter_declaration declarator: (identifier) @local.definition)
(parameter_declaration declarator: (pointer_declarator declarator: (identifier) @local.definition))
(parameter_declaration declarator: (reference_declarator (identifier) @local.definition))
(parameter_declaration declarator: (array_declarator declarator: (identifier) @local.definition))
(optional_parameter_declaration declarator: (identifier) @local.definition)
(optional_parameter_declaration declarator: (pointer_declarator declarator: (identifier) @local.definition))
(optional_parameter_declaration declarator: (reference_declarator (identifier) @local.definition))

(declaration declarator: (identifier) @local.definition)
(declaration declarator: (init_declarator declarator: (identifier) @local.definition))
(declaration declarator: (init_declarator declarator: (pointer_declarator declarator: (identifier) @local.definition)))
(declaration declarator: (init_declarator declarator: (reference_declarator (identifier) @local.definition)))
(declaration declarator: (init_declarator declarator: (array_declarator declarator: (identifier) @local.definition)))
(declaration declarator: (pointer_declarator declarator: (identifier) @local.definition))
(declaration declarator: (reference_declarator (identifier) @local.definition))
(declaration declarator: (array_declarator declarator: (identifier) @local.definition))

(for_range_loop declarator: (identifier) @local.definition)
(for_range_loop declarator: (pointer_declarator declarator: (identifier) @local.definition))
(for_range_loop declarator: (reference_declarator (identifier) @local.definition))
(for_range_loop declarator: (structured_binding_declarator (identifier) @local.definition))
(declaration declarator: (structured_binding_declarator (identifier) @local.definition))

(lambda_capture_specifier (identifier) @local.reference)

; References

(identifier) @local.reference
