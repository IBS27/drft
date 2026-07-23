import ConvexMobile

public extension ConvexClientWithAuth where T == String {
    @MainActor
    convenience init(deploymentUrl: String, authProvider: ClerkConvexAuthProvider) {
        self.init(
            deploymentUrl: deploymentUrl,
            authProvider: authProvider as any AuthProvider<String>
        )
        authProvider.bind(client: self)
    }
}
