import Foundation

// Daily draft finalize and export, and the baseline. Reuses BackendClient's request helper.

public extension BackendClient {
    /// POST /v1/drafts/:id/finalize  "Done for Today".
    func finalize(draft id: String, credentials: DeviceCredentials) async throws -> FinalizeResponse {
        try await send("POST", "/v1/drafts/\(Self.pathSegment(id))/finalize", body: Empty?.none, token: credentials.token)
    }

    /// GET /v1/drafts/:id/export  The CSV text (date,client,minutes,narrative,status). 409 before finalize.
    func exportCSV(draft id: String, credentials: DeviceCredentials) async throws -> Data {
        var request = try makeRequest("GET", "/v1/drafts/\(Self.pathSegment(id))/export", body: Empty?.none, token: credentials.token)
        request.setValue("text/csv", forHTTPHeaderField: "Accept")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BackendError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw BackendError.badResponse }
        if http.statusCode == 401 || http.statusCode == 403 { throw BackendError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw BackendError.server(status: http.statusCode) }
        return data
    }

    /// POST /v1/baseline  Replaces that day's usual timesheet.
    func saveBaseline(_ baseline: Baseline, credentials: DeviceCredentials) async throws -> Baseline {
        try await send("POST", "/v1/baseline", body: baseline, token: credentials.token)
    }

    internal static func pathSegment(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }
}
