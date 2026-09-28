import React from "react";
import { ApiClient, type User } from "./api";
import { UserList } from "./components/UserList";
import { formatName } from "./legacy/format";
import { apiBase } from "./config";

interface AppState {
  users: User[];
  selected?: User;
}

function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main>
      <h1>{formatName(title, "Team")}</h1>
      {children}
    </main>
  );
}

export class App extends React.Component<{ client: ApiClient }, AppState> {
  state: AppState = { users: [] };

  constructor(props: { client: ApiClient }) {
    super(props);
  }

  handleSelect = (user: User) => {
    this.setState({ selected: user });
  };

  async componentDidMount() {
    const users = await this.props.client.users();
    this.setState({ users });
  }

  render() {
    return (
      <Layout title="Users">
        <UserList users={this.state.users} onSelect={this.handleSelect} />
      </Layout>
    );
  }
}

export function bootstrap(): App {
  const client = new ApiClient(apiBase());
  return new App({ client });
}
