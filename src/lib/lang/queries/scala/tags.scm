; Scala tags for Coderimpact: based on tree-sitter-scala's tags.scm.
; Changes: vals/vars are definitions only in class/object/trait bodies and at
; the top level (local vals are handled by locals.scm, so their references
; resolve inside the method); method calls obj.m() and generic calls m[T]()
; are references; types in signatures are references; the package clause is
; not a definition (it only made a block on the package line).

; Definitions

(trait_definition
  name: (identifier) @name) @definition.interface

(enum_definition
  name: (identifier) @name) @definition.enum

(simple_enum_case
  name: (identifier) @name) @definition.class

(full_enum_case
  name: (identifier) @name) @definition.class

(class_definition
  name: (identifier) @name) @definition.class

(object_definition
  name: (identifier) @name) @definition.object

(function_definition
  name: (identifier) @name) @definition.function

(function_declaration
  name: (identifier) @name) @definition.function

(template_body
  (val_definition
    pattern: (identifier) @name) @definition.property)

(template_body
  (var_definition
    pattern: (identifier) @name) @definition.property)

(template_body
  (val_declaration
    name: (identifier) @name) @definition.property)

(template_body
  (var_declaration
    name: (identifier) @name) @definition.property)

(template_body
  (given_definition
    name: (identifier) @name) @definition.variable)

(compilation_unit
  (val_definition
    pattern: (identifier) @name) @definition.variable)

(compilation_unit
  (var_definition
    pattern: (identifier) @name) @definition.variable)

(compilation_unit
  (given_definition
    name: (identifier) @name) @definition.variable)

(type_definition
  name: (type_identifier) @name) @definition.type

(class_parameter
  name: (identifier) @name) @definition.property

; References

; f(), Foo() (apply), f[T]()
(call_expression
  function: (identifier) @name) @reference.call

(call_expression
  function: (generic_function
    function: (identifier) @name)) @reference.call

; obj.m(), Obj.m(), obj.m[T]()
(call_expression
  function: (field_expression
    field: (identifier) @name)) @reference.call

(call_expression
  function: (generic_function
    function: (field_expression
      field: (identifier) @name))) @reference.call

; Receivers: obj.m, Obj.m (locals claim variables first)
(field_expression
  value: (identifier) @name) @reference.variable

; Member access without a call: obj.name
(field_expression
  field: (identifier) @name) @reference.field

(instance_expression
  (type_identifier) @name) @reference.interface

(instance_expression
  (generic_type
    (type_identifier) @name)) @reference.interface

(extends_clause
  (type_identifier) @name) @reference.class

(extends_clause
  (generic_type
    (type_identifier) @name)) @reference.class

; Types in parameters, return types, type arguments and ascriptions.
((type_identifier) @name) @reference.type
