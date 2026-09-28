; Scopes: every function clause, anonymous function clause, case/receive
; clause and comprehension has its own variables.

((call target: (identifier) @_def) @local.scope
  (#any-of? @_def "def" "defp" "defmacro" "defmacrop" "defguard" "defguardp" "defn" "defnp" "for" "with"))

(stab_clause) @local.scope

; Definitions: variables bound by patterns. Patterns nest (tuples, lists,
; maps), so the common shapes are listed up to one level deep.

; Function clause parameters: `def f(a, {b, c}, [h | t], %{k: v} = m, d \\ 1)`
(call
  target: (identifier) @_def
  (arguments
    [
      (call (arguments
        [
          (identifier) @local.definition
          (tuple (identifier) @local.definition)
          (list (identifier) @local.definition)
          (list (binary_operator left: (identifier) @local.definition operator: "|"))
          (list (binary_operator operator: "|" right: (identifier) @local.definition))
          (map (map_content (keywords (pair value: (identifier) @local.definition))))
          (binary_operator left: (identifier) @local.definition operator: "=")
          (binary_operator operator: "=" right: (identifier) @local.definition)
          (binary_operator left: (map (map_content (keywords (pair value: (identifier) @local.definition)))) operator: "=")
          (binary_operator left: (tuple (identifier) @local.definition) operator: "=")
          (binary_operator left: (identifier) @local.definition operator: "\\\\")
        ]))
      (binary_operator
        left: (call (arguments
          [
            (identifier) @local.definition
            (tuple (identifier) @local.definition)
            (list (identifier) @local.definition)
            (list (binary_operator left: (identifier) @local.definition operator: "|"))
            (list (binary_operator operator: "|" right: (identifier) @local.definition))
            (map (map_content (keywords (pair value: (identifier) @local.definition))))
            (binary_operator left: (identifier) @local.definition operator: "=")
            (binary_operator operator: "=" right: (identifier) @local.definition)
            (binary_operator left: (identifier) @local.definition operator: "\\\\")
          ]))
        operator: "when")
    ])
  (#any-of? @_def "def" "defp" "defmacro" "defmacrop" "defguard" "defguardp" "defn" "defnp"))

; Clause heads: `fn a, {b, c} -> ... end`, `{:ok, v} -> ...` in case/receive/with
(stab_clause
  left: (arguments
    [
      (identifier) @local.definition
      (tuple (identifier) @local.definition)
      (list (identifier) @local.definition)
      (list (binary_operator left: (identifier) @local.definition operator: "|"))
      (list (binary_operator operator: "|" right: (identifier) @local.definition))
      (map (map_content (keywords (pair value: (identifier) @local.definition))))
      (binary_operator left: (identifier) @local.definition operator: "=")
      (binary_operator operator: "=" right: (identifier) @local.definition)
      (binary_operator left: (identifier) @local.definition operator: "when")
    ]))

; Match and generator bindings: `x = ...`, `{a, b} = ...`, `x <- list`
(binary_operator
  left: [
    (identifier) @local.definition
    (tuple (identifier) @local.definition)
    (list (identifier) @local.definition)
    (list (binary_operator left: (identifier) @local.definition operator: "|"))
    (list (binary_operator operator: "|" right: (identifier) @local.definition))
    (map (map_content (keywords (pair value: (identifier) @local.definition))))
  ]
  operator: ["=" "<-"])

; References: identifiers in expression positions. Call targets (`total(x)`)
; and remote function names (`Cart.total`) are functions, not variables, and
; `@rate` is a module attribute.

(arguments (identifier) @local.reference)
(binary_operator left: (identifier) @local.reference)
(binary_operator
  operator: _ @_op
  right: (identifier) @local.reference
  (#not-eq? @_op "|>"))
(dot left: (identifier) @local.reference)
(access_call target: (identifier) @local.reference)
(pair value: (identifier) @local.reference)
(unary_operator
  operator: ["^" "-" "+" "!" "not"]
  operand: (identifier) @local.reference)

([
  (list (identifier) @local.reference)
  (tuple (identifier) @local.reference)
  (map_content (identifier) @local.reference)
  (bitstring (identifier) @local.reference)
  (block (identifier) @local.reference)
  (body (identifier) @local.reference)
  (do_block (identifier) @local.reference)
  (else_block (identifier) @local.reference)
  (after_block (identifier) @local.reference)
  (rescue_block (identifier) @local.reference)
  (catch_block (identifier) @local.reference)
  (interpolation (identifier) @local.reference)
  (source (identifier) @local.reference)
])
