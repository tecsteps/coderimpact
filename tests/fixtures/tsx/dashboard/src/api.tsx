export interface User {
  id: number;
  name: string;
}

export class ApiClient {
  constructor(private readonly base: string) {}

  async get<T>(path: string): Promise<T> {
    const response = await fetch(this.base + path);
    return (await response.json()) as T;
  }

  users(): Promise<User[]> {
    return this.get<User[]>("/users");
  }
}

export function formatName(user: User): string {
  return user.name.trim();
}
