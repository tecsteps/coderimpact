; C# tags for Coderimpact: based on tree-sitter-c-sharp's tags.scm, extended
; with constructors, properties, fields, structs, records, enums, delegates,
; bare calls and type references. Namespaces are not definitions: a class in a
; namespace stays a top-level declaration (block-scoped and file-scoped
; namespaces behave the same, and qualified names like Acme.Shop never matched).

; Definitions

(class_declaration name: (identifier) @name) @definition.class

(struct_declaration name: (identifier) @name) @definition.struct

(record_declaration name: (identifier) @name) @definition.class

(interface_declaration name: (identifier) @name) @definition.interface

(enum_declaration name: (identifier) @name) @definition.enum

(delegate_declaration name: (identifier) @name) @definition.type

(method_declaration name: (identifier) @name) @definition.method

(constructor_declaration name: (identifier) @name) @definition.constructor

(local_function_statement name: (identifier) @name) @definition.function

(property_declaration name: (identifier) @name) @definition.property

(field_declaration
  (variable_declaration
    (variable_declarator name: (identifier) @name))) @definition.field

(event_field_declaration
  (variable_declaration
    (variable_declarator name: (identifier) @name))) @definition.field

(enum_member_declaration name: (identifier) @name) @definition.constant

; References: calls

(invocation_expression function: (member_access_expression name: (identifier) @name)) @reference.send

(invocation_expression function: (identifier) @name) @reference.call

(invocation_expression function: (generic_name . (identifier) @name)) @reference.call

(invocation_expression function: (member_access_expression name: (generic_name . (identifier) @name))) @reference.send

; References: types

(class_declaration (base_list (_) @name)) @reference.class

(interface_declaration (base_list (_) @name)) @reference.interface

(struct_declaration (base_list (_) @name)) @reference.interface

(record_declaration (base_list (_) @name)) @reference.class

(object_creation_expression type: (identifier) @name) @reference.class

(object_creation_expression type: (generic_name . (identifier) @name)) @reference.class

(type_parameter_constraints_clause (identifier) @name) @reference.class

(type_parameter_constraint (type type: (identifier) @name)) @reference.class

(variable_declaration type: (identifier) @name) @reference.class

(parameter type: (identifier) @name) @reference.class

(method_declaration returns: (identifier) @name) @reference.class

(property_declaration type: (identifier) @name) @reference.class

(local_function_statement type: (identifier) @name) @reference.class

(type_argument_list (identifier) @name) @reference.class

(array_type type: (identifier) @name) @reference.class

(nullable_type type: (identifier) @name) @reference.class

(typeof_expression type: (identifier) @name) @reference.class

(cast_expression type: (identifier) @name) @reference.class

(declaration_pattern type: (identifier) @name) @reference.class

(catch_declaration type: (identifier) @name) @reference.class

; References: receivers and members (locals claim variables first)

(member_access_expression expression: (identifier) @name) @reference.variable

(member_access_expression name: (identifier) @name) @reference.field
