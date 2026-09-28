; Java tags for Coderimpact: based on tree-sitter-java's tags.scm, extended with
; constructors, enums, records, fields and type/static references.

; Definitions

(class_declaration
  name: (identifier) @name) @definition.class

(interface_declaration
  name: (identifier) @name) @definition.interface

(enum_declaration
  name: (identifier) @name) @definition.enum

(record_declaration
  name: (identifier) @name) @definition.class

(annotation_type_declaration
  name: (identifier) @name) @definition.interface

(method_declaration
  name: (identifier) @name) @definition.method

(constructor_declaration
  name: (identifier) @name) @definition.constructor

(compact_constructor_declaration
  name: (identifier) @name) @definition.constructor

(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition.field

(constant_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition.constant

(enum_constant
  name: (identifier) @name) @definition.constant

; References

(method_invocation
  name: (identifier) @name
  arguments: (argument_list) @reference.call)

(object_creation_expression
  type: (type_identifier) @name) @reference.class

(object_creation_expression
  type: (generic_type (type_identifier) @name)) @reference.class

(superclass (type_identifier) @name) @reference.class

(type_list
  (type_identifier) @name) @reference.implementation

; Types in declarations, parameters, return types and generic arguments.
((type_identifier) @name) @reference.type

; Type.staticMethod(), obj.method(): the receiver (locals claim variables first).
(method_invocation
  object: (identifier) @name) @reference.variable

; obj.field, Type.CONSTANT, this.field
(field_access
  object: (identifier) @name) @reference.variable

(field_access
  field: (identifier) @name) @reference.field

; Method references: Type::method
(method_reference
  . (identifier) @name) @reference.variable
