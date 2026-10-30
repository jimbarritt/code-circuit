class HomeFeed
  def initialize(account)
    @account = account
  end

  def get(limit)
    FeedManager.instance.query(:home, @account.id, limit)
  end
end
