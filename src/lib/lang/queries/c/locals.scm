; Locals for C: parameters and block-scoped variables.

; Scopes

(function_definition) @local.scope
(compound_statement) @local.scope
(for_statement) @local.scope

; Parameters of a prototype belong to the prototype only.
(declaration declarator: (function_declarator parameters: (parameter_list) @local.scope))
(field_declaration declarator: (function_declarator parameters: (parameter_list) @local.scope))

; Definitions

(parameter_declaration declarator: (identifier) @local.definition)
(parameter_declaration declarator: (pointer_declarator declarator: (identifier) @local.definition))
(parameter_declaration declarator: (pointer_declarator declarator: (pointer_declarator declarator: (identifier) @local.definition)))
(parameter_declaration declarator: (array_declarator declarator: (identifier) @local.definition))

(declaration declarator: (identifier) @local.definition)
(declaration declarator: (init_declarator declarator: (identifier) @local.definition))
(declaration declarator: (init_declarator declarator: (pointer_declarator declarator: (identifier) @local.definition)))
(declaration declarator: (init_declarator declarator: (array_declarator declarator: (identifier) @local.definition)))
(declaration declarator: (pointer_declarator declarator: (identifier) @local.definition))
(declaration declarator: (array_declarator declarator: (identifier) @local.definition))

; Function-like macro parameters
(preproc_function_def) @local.scope
(preproc_params (identifier) @local.definition)

; References

(identifier) @local.reference

