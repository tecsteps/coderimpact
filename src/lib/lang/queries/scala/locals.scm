; Scala locals for Coderimpact: based on tree-sitter-scala's locals.scm.
; Changes: every def, block, lambda, for and case is a scope (parameters of
; two methods in one class no longer share the class scope), and references
; are listed per expression position so that member names (obj.name) never
; bind to a local of the same name.

; Scopes

(template_body) @local.scope
(lambda_expression) @local.scope
(function_definition) @local.scope
(function_declaration) @local.scope
(block) @local.scope
(indented_block) @local.scope
(for_expression) @local.scope
(case_clause) @local.scope
(catch_clause) @local.scope

; Definitions
; (Method names are not listed: tags.scm defines every def, nested ones too.)

(parameter
  name: (identifier) @local.definition)

(binding
  name: (identifier) @local.definition)

(lambda_expression
  parameters: (identifier) @local.definition)

(val_definition
  pattern: (identifier) @local.definition)

(var_definition
  pattern: (identifier) @local.definition)

(val_declaration
  name: (identifier) @local.definition)

(var_declaration
  name: (identifier) @local.definition)

(val_definition
  pattern: (tuple_pattern (identifier) @local.definition))

(enumerator
  . (identifier) @local.definition)

(enumerator
  . (tuple_pattern (identifier) @local.definition))

(case_clause
  pattern: (identifier) @local.definition)

(typed_pattern
  pattern: (identifier) @local.definition)

; References (expression positions only)

(arguments (identifier) @local.reference)
(infix_expression left: (identifier) @local.reference)
(infix_expression right: (identifier) @local.reference)
(prefix_expression (identifier) @local.reference)
(postfix_expression . (identifier) @local.reference)
(assignment_expression (identifier) @local.reference)
(return_expression (identifier) @local.reference)
(throw_expression (identifier) @local.reference)
(parenthesized_expression (identifier) @local.reference)
(tuple_expression (identifier) @local.reference)
(if_expression consequence: (identifier) @local.reference)
(if_expression alternative: (identifier) @local.reference)
(while_expression (identifier) @local.reference)
(match_expression value: (identifier) @local.reference)
(case_clause body: (identifier) @local.reference)
(val_definition value: (identifier) @local.reference)
(var_definition value: (identifier) @local.reference)
(function_definition body: (identifier) @local.reference)
(lambda_expression (identifier) @local.reference .)
(call_expression function: (identifier) @local.reference)
(field_expression value: (identifier) @local.reference)
(ascription_expression . (identifier) @local.reference)
(interpolation (identifier) @local.reference)
(enumerator (identifier) @local.reference .)
(block (identifier) @local.reference)
(indented_block (identifier) @local.reference)
