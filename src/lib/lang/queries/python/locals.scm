; Scopes: functions, lambdas, classes and comprehensions have their own names.
; Plain blocks (if/for/with/try) do not create a scope in Python.

[
  (function_definition)
  (lambda)
  (class_definition)
  (list_comprehension)
  (set_comprehension)
  (dictionary_comprehension)
  (generator_expression)
] @local.scope

; Parameters

(parameters (identifier) @local.definition)
(lambda_parameters (identifier) @local.definition)
(default_parameter name: (identifier) @local.definition)
(typed_parameter (identifier) @local.definition)
(typed_default_parameter name: (identifier) @local.definition)
(list_splat_pattern (identifier) @local.definition)
(dictionary_splat_pattern (identifier) @local.definition)

; Assignments and bindings. Imports are deliberately not local definitions:
; an imported class or function must resolve to its declaration in the
; other file, not to the import line.

(assignment left: (identifier) @local.definition)
(pattern_list (identifier) @local.definition)
(tuple_pattern (identifier) @local.definition)
(list_pattern (identifier) @local.definition)
(for_statement left: (identifier) @local.definition)
(for_in_clause left: (identifier) @local.definition)
(as_pattern_target (identifier) @local.definition)
(named_expression name: (identifier) @local.definition)

; References: identifiers used as expressions. The parents are listed
; explicitly because `obj.attr` (attribute field) and keyword argument names
; are identifiers too, but not variables.

(attribute object: (identifier) @local.reference)
(keyword_argument value: (identifier) @local.reference)
(default_parameter value: (identifier) @local.reference)
(typed_default_parameter value: (identifier) @local.reference)
(named_expression value: (identifier) @local.reference)
(assignment right: (identifier) @local.reference)
(augmented_assignment [left: (identifier) right: (identifier)] @local.reference)
(for_statement right: (identifier) @local.reference)
(for_in_clause right: (identifier) @local.reference)
(interpolation expression: (identifier) @local.reference)
(format_expression expression: (identifier) @local.reference)
(print_statement argument: (identifier) @local.reference)
(subscript [value: (identifier) subscript: (identifier)] @local.reference)
(lambda body: (identifier) @local.reference)
(match_statement subject: (identifier) @local.reference)
(except_clause value: (identifier) @local.reference)
(with_item value: (identifier) @local.reference)
(as_pattern . (identifier) @local.reference)

([
  (argument_list (identifier) @local.reference)
  (expression_statement (identifier) @local.reference)
  (return_statement (identifier) @local.reference)
  (binary_operator (identifier) @local.reference)
  (boolean_operator (identifier) @local.reference)
  (comparison_operator (identifier) @local.reference)
  (not_operator (identifier) @local.reference)
  (unary_operator (identifier) @local.reference)
  (call function: (identifier) @local.reference)
  (slice (identifier) @local.reference)
  (list (identifier) @local.reference)
  (tuple (identifier) @local.reference)
  (set (identifier) @local.reference)
  (pair (identifier) @local.reference)
  (expression_list (identifier) @local.reference)
  (parenthesized_expression (identifier) @local.reference)
  (conditional_expression (identifier) @local.reference)
  (list_comprehension body: (identifier) @local.reference)
  (set_comprehension body: (identifier) @local.reference)
  (generator_expression body: (identifier) @local.reference)
  (if_clause (identifier) @local.reference)
  (if_statement condition: (identifier) @local.reference)
  (elif_clause condition: (identifier) @local.reference)
  (while_statement condition: (identifier) @local.reference)
  (list_splat (identifier) @local.reference)
  (dictionary_splat (identifier) @local.reference)
  (await (identifier) @local.reference)
  (yield (identifier) @local.reference)
  (assert_statement (identifier) @local.reference)
  (delete_statement (identifier) @local.reference)
  (raise_statement (identifier) @local.reference)
  (decorator (identifier) @local.reference)
])
