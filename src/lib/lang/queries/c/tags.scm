; Tags for C: definitions with an @name capture, references by name.
; Function prototypes (a declaration without a body) are deliberately not
; definitions: a call resolves to the one function body instead of offering
; the header prototype and the definition as two candidates.

; Types

(struct_specifier name: (type_identifier) @name body: (_)) @definition.struct

(union_specifier name: (type_identifier) @name body: (_)) @definition.union

(enum_specifier name: (type_identifier) @name body: (_)) @definition.enum

; `typedef struct Point {...} Point;` keeps only the struct: two declarations
; with the same name would turn every use into candidates.
(type_definition
  type: (_ name: (type_identifier) @_tag)
  declarator: (type_identifier) @name
  (#not-eq? @_tag @name)) @definition.type

(type_definition
  type: (_ !name)
  declarator: (type_identifier) @name) @definition.type

(type_definition
  declarator: (function_declarator declarator: (parenthesized_declarator (pointer_declarator declarator: (type_identifier) @name)))) @definition.type

; Fields and enum constants

(field_declaration declarator: (field_identifier) @name) @definition.field

(field_declaration declarator: (pointer_declarator declarator: (field_identifier) @name)) @definition.field

(field_declaration declarator: (array_declarator declarator: (field_identifier) @name)) @definition.field

(enumerator name: (identifier) @name) @definition.constant

; Functions (with a body)

(function_definition
  declarator: (function_declarator declarator: (identifier) @name)) @definition.function

(function_definition
  declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @definition.function

(function_definition
  declarator: (pointer_declarator declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name)))) @definition.function

; Macros

(preproc_function_def name: (identifier) @name) @definition.macro

(preproc_def name: (identifier) @name) @definition.constant

; File-scope variables (also inside #ifdef blocks)

(translation_unit
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

(preproc_ifdef
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

(preproc_if
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

(preproc_else
  (declaration declarator: [
    (identifier) @name
    (init_declarator declarator: (identifier) @name)
    (init_declarator declarator: (pointer_declarator declarator: (identifier) @name))
    (init_declarator declarator: (array_declarator declarator: (identifier) @name))
    (pointer_declarator declarator: (identifier) @name)
    (array_declarator declarator: (identifier) @name)
  ]) @definition.variable)

; References (call patterns first: the first match of a name wins)

(call_expression function: (identifier) @name) @reference.call

(call_expression function: (field_expression field: (field_identifier) @name)) @reference.call

(field_expression field: (field_identifier) @name) @reference.field

(type_identifier) @name @reference.type

(identifier) @name @reference.variable
