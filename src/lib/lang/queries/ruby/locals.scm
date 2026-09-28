; Scopes. A method body does not see the names around it; blocks and lambdas
; see the names of the enclosing method.

((method) @local.scope
 (#set! local.scope-inherits false))

((singleton_method) @local.scope
 (#set! local.scope-inherits false))

[
  (lambda)
  (block)
  (do_block)
] @local.scope

; Parameters

(block_parameter (identifier) @local.definition)
(block_parameters (identifier) @local.definition)
(destructured_parameter (identifier) @local.definition)
(hash_splat_parameter (identifier) @local.definition)
(lambda_parameters (identifier) @local.definition)
(method_parameters (identifier) @local.definition)
(splat_parameter (identifier) @local.definition)

(keyword_parameter name: (identifier) @local.definition)
(optional_parameter name: (identifier) @local.definition)

; Assignments. `x += 1` (operator_assignment) needs an existing variable,
; so it is a reference, not a new definition.

(assignment left: (identifier) @local.definition)
(left_assignment_list (identifier) @local.definition)
(rest_assignment (identifier) @local.definition)
(destructured_left_assignment (identifier) @local.definition)
(exception_variable (identifier) @local.definition)
(for pattern: (identifier) @local.definition)

; References: identifiers in expression positions. The method name of a call
; (`obj.total`, `total(1)`) is not a variable, so `call` only contributes its
; receiver; alias/undef/setter names are method names too.

(call receiver: (identifier) @local.reference)

([
  (argument_list (identifier) @local.reference)
  (array (identifier) @local.reference)
  (assignment (identifier) @local.reference)
  (begin (identifier) @local.reference)
  (binary (identifier) @local.reference)
  (block_argument (identifier) @local.reference)
  (block_body (identifier) @local.reference)
  (body_statement (identifier) @local.reference)
  (case (identifier) @local.reference)
  (case_match (identifier) @local.reference)
  (conditional (identifier) @local.reference)
  (do (identifier) @local.reference)
  (element_reference (identifier) @local.reference)
  (else (identifier) @local.reference)
  (elsif (identifier) @local.reference)
  (ensure (identifier) @local.reference)
  (exceptions (identifier) @local.reference)
  (hash_splat_argument (identifier) @local.reference)
  (if (identifier) @local.reference)
  (if_guard (identifier) @local.reference)
  (if_modifier (identifier) @local.reference)
  (interpolation (identifier) @local.reference)
  (keyword_parameter value: (identifier) @local.reference)
  (operator_assignment (identifier) @local.reference)
  (optional_parameter value: (identifier) @local.reference)
  (pair (identifier) @local.reference)
  (parenthesized_statements (identifier) @local.reference)
  (program (identifier) @local.reference)
  (range (identifier) @local.reference)
  (rescue_modifier (identifier) @local.reference)
  (right_assignment_list (identifier) @local.reference)
  (splat_argument (identifier) @local.reference)
  (superclass (identifier) @local.reference)
  (then (identifier) @local.reference)
  (unary (identifier) @local.reference)
  (unless (identifier) @local.reference)
  (unless_guard (identifier) @local.reference)
  (unless_modifier (identifier) @local.reference)
  (until (identifier) @local.reference)
  (until_modifier (identifier) @local.reference)
  (while (identifier) @local.reference)
  (while_modifier (identifier) @local.reference)
  (for (identifier) @local.reference)
  (in (identifier) @local.reference)
  (match_pattern (identifier) @local.reference)
  (test_pattern (identifier) @local.reference)
  (expression_reference_pattern (identifier) @local.reference)
])
