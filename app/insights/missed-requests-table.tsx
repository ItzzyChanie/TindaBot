import Link from "next/link";

export type MissedRequest = {
  id: string;
  request_text: string;
  created_at: string;
};

export function MissedRequestsTable({
  requests,
  page,
  total,
}: {
  requests: MissedRequest[];
  page: number;
  total: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / 15));
  return (
    <>
      <div className="missed-table-wrap">
        <table className="missed-table" aria-label="Seller follow-up requests">
          <thead className="missed-table-head">
            <tr>
              <th>Request</th>
              <th>Received</th>
              <th><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{request.request_text}</td>
                <td>
                  <time dateTime={request.created_at}>
                    {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(request.created_at))}
                  </time>
                </td>
                <td>
                  <Link className="text-button" href={"/catalog?newProduct=" + encodeURIComponent(request.request_text.slice(0, 120))}>
                    Add to catalog
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 15 && (
        <nav className="table-pagination" aria-label="Seller follow-up pages">
          {page > 0 ? <Link className="text-button" href={`?followupPage=${page - 1}#seller-follow-up`}>Previous</Link> : <span />}
          <span>Page {page + 1} of {pageCount}</span>
          {page + 1 < pageCount ? <Link className="text-button" href={`?followupPage=${page + 1}#seller-follow-up`}>Next</Link> : <span />}
        </nav>
      )}
    </>
  );
}
