export type TaskQueueCard = {
  id: string;
  name: string;
  url: string | null;
  listId: string;
  listName: string | null;
  labels: string[];
};

export type TaskQueueList = {
  id: string;
  name: string;
  closed: boolean | null;
};

export type TaskQueueSnapshot = {
  board: { id: string; name: string; url: string | null };
  lists: TaskQueueList[];
  cards: TaskQueueCard[];
  fetchedAt: number;
};
