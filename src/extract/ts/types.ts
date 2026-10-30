import type ts from "typescript";

/** Shared contracts of the TypeScript extractor. See docs/typescript-extractor.md. */

export interface Module {
  /** package.json name, else project.json name, else directory relative to the root ("." for the root). */
  name: string;
  /** Directory relative to the root, "." for the root. */
  dir: string;
  /** How the module was found. */
  source: "workspace" | "nx" | "manifest" | "root";
}

export interface SourceFile {
  /** Path relative to the root, with forward slashes. */
  rel: string;
  /** Module name. */
  module: string;
  sf: ts.SourceFile;
}

export interface Project {
  root: string;
  modules: Module[];
  files: SourceFile[];
  file(rel: string): SourceFile | undefined;
  /** Resolves an import specifier written in `fromRel` to a file relative to the root. */
  resolveImport(fromRel: string, specifier: string): string | undefined;
}

export interface Decorator {
  /** Decorator name, for example "Controller" or "GrpcMethod": the exported name when the import is aliased or a namespace. */
  name: string;
  /** Callee as written when it differs from `name`, for example "G" or "common.Get". */
  local?: string;
  /** Package the decorator comes from, after aliases, namespaces and local re-exports. Set by buildIndex. */
  spec?: string;
  args: ts.Expression[];
  line: number;
}

export interface Dependency {
  /** Constructor parameter name, for example "userService". */
  param: string;
  /** Type name as written, for example "UserService" or "Repository<User>". */
  typeName?: string;
  /** Text of the @Inject / @InjectRepository / @InjectModel / @InjectQueue argument, folded when possible. */
  token?: string;
  /** Name of the inject decorator, when there is one. */
  injectedBy?: string;
  /** Id of the class the dependency resolves to, when that class is in the repo. */
  classId?: string;
}

export interface Call {
  /** Dependency parameter name: this.<dep>.<method>(). */
  dep: string;
  method: string;
  line: number;
  node: ts.CallExpression;
}

/** A call to a top-level function in the repo: `publishSignup(id)`. */
export interface FnCall {
  /** Function node id. */
  fn: string;
  line: number;
}

export interface MethodSym {
  name: string;
  line: number;
  decorators: Decorator[];
  node: ts.MethodDeclaration | ts.PropertyDeclaration;
  calls: Call[];
  fnCalls?: FnCall[];
}

export interface ClassSym {
  /** Node id: <module>:<ClassName>. */
  id: string;
  name: string;
  module: string;
  file: string;
  line: number;
  decorators: Decorator[];
  deps: Dependency[];
  methods: MethodSym[];
  extends?: string;
  /** Id of the base class, when it is in the repo. */
  base?: string;
  abstract?: boolean;
  node: ts.ClassDeclaration;
}

export interface FunctionSym {
  /** Node id: <module>:<file>#<name>. */
  id: string;
  name: string;
  module: string;
  file: string;
  line: number;
  node: ts.FunctionDeclaration | ts.VariableDeclaration;
  fnCalls?: FnCall[];
}

export interface SymbolIndex {
  classes: ClassSym[];
  functions: FunctionSym[];
  classById: Map<string, ClassSym>;
  /** Classes by name; a name can occur in more than one module. */
  classesByName: Map<string, ClassSym[]>;
  /** Nest custom providers: the class or token id given to `provide`, to the class ids of `useClass` or `useExisting`. */
  bindings?: Map<string, string[]>;
  /** Folds an expression to a string; undefined when it cannot. */
  resolveValue(expr: ts.Expression, fileRel: string): string | undefined;
  /** Id of the node that owns a position: the enclosing class, else function, else `<module>:<file>`. */
  ownerOf(fileRel: string, node: ts.Node): { id: string; symbol: string };
}

export type EntryKind = "http" | "grpc" | "graphql" | "message" | "queue" | "cron" | "websocket";
export type ExitKind = "database" | "cache" | "http-out" | "grpc-out" | "message-out" | "queue-out" | "cloud";

export interface Finding {
  direction: "entry" | "exit";
  kind: EntryKind | ExitKind;
  protocol: string;
  method: string;
  target: string;
  resolved: boolean;
  module: string;
  file: string;
  line: number;
  symbol: string;
  node: string;
  rule: string;
  /** Free text for anything else worth showing, for example the transport options. */
  detail?: string;
}

export interface DetectContext {
  project: Project;
  index: SymbolIndex;
}

export interface Detector {
  name: string;
  detect(ctx: DetectContext): Finding[];
}
