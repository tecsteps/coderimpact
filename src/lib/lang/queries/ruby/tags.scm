; Method definitions

; A `def` at the top level of a file is a function (listed first so it wins
; over the generic method pattern below).
(program
  (method
    name: (_) @name) @definition.function)

(
  (comment)* @doc
  .
  [
    (method
      name: (_) @name) @definition.method
    (singleton_method
      name: (_) @name) @definition.method
  ]
  (#strip! @doc "^#\\s*")
  (#select-adjacent! @doc @definition.method)
)

(alias
  name: (_) @name) @definition.method

(setter
  (identifier) @ignore)

; Class definitions

(
  (comment)* @doc
  .
  [
    (class
      name: [
        (constant) @name
        (scope_resolution
          name: (_) @name)
      ]) @definition.class
    (singleton_class
      value: [
        (constant) @name
        (scope_resolution
          name: (_) @name)
      ]) @definition.class
  ]
  (#strip! @doc "^#\\s*")
  (#select-adjacent! @doc @definition.class)
)

; Module definitions

(
  (module
    name: [
      (constant) @name
      (scope_resolution
        name: (_) @name)
    ]) @definition.module
)

; Calls

(call method: (identifier) @name) @reference.call

; A bare identifier is either a local variable or a method call without
; arguments (`total`, `header`). locals.scm claims the local variables first;
; the rest are calls. They are tagged "send" (also a call) so that a local
; variable read keeps the role "ref".
(
  (identifier) @name @reference.send
  (#not-match? @name "^(lambda|load|require|require_relative|__FILE__|__LINE__)$")
)

; Constants: `Invoice`, `Billing::Invoice`, `Invoice.new`. Tagged as a
; reference (not a call): `Money.round(x)` calls `round`, not `Money`.
(
  (constant) @name @reference.class
  (#not-match? @name "^(__FILE__|__LINE__)$")
)
