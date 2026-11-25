/** Host-independent state: file identity and expansion identity are different. */
export interface TreeNode {
  id: number;
  path: string;
  parent: TreeNode | null;
  children: TreeNode[];
}
export class ReadingTree {
  readonly nodes = new Map<number, TreeNode>();
  private nextId = 0;
  constructor(readonly limit = 100) {}
  add(path: string, parent: TreeNode | null): TreeNode {
    if (parent && !this.nodes.has(parent.id)) throw new Error('父分支已关闭');
    if (!parent && this.nodes.size) throw new Error('只能有一个入口');
    if (this.nodes.size >= this.limit) throw new Error(`最多展开 ${this.limit} 张卡片`);
    if (parent?.children.some(child => child.path === path)) throw new Error('分支已存在');
    const node = {id:++this.nextId, path, parent, children:[]} as TreeNode;
    this.nodes.set(node.id,node);parent?.children.push(node);return node;
  }
  ancestor(node: TreeNode, path: string): TreeNode | null {
    for (let current: TreeNode | null = node; current; current = current.parent) if (current.path === path) return current;
    return null;
  }
  remove(node: TreeNode): void {
    if (!this.nodes.has(node.id)) return;
    for (const child of [...node.children]) this.remove(child);
    this.nodes.delete(node.id);
    if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
  }
}
